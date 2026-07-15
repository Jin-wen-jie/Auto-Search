import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}

interface HourlyWorkflow {
  name: string;
  on: {
    push: {
      branches: string[];
      paths: string[];
    };
    schedule: Array<{ cron: string }>;
    workflow_dispatch: unknown;
  };
  permissions: Record<string, string>;
  concurrency: {
    group: string;
    "cancel-in-progress": boolean;
  };
  jobs: {
    collect: {
      "runs-on": string;
      "timeout-minutes": number;
      env: Record<string, string>;
      steps: WorkflowStep[];
    };
  };
}

const workflowText = readFileSync(
  ".github/workflows/hourly-collection.yml",
  "utf8",
);
const workflow = YAML.parse(workflowText) as HourlyWorkflow;
const collect = workflow.jobs.collect;

function stepNamed(name: string): WorkflowStep {
  const step = collect.steps.find((candidate) => candidate.name === name);
  expect(step).toBeDefined();
  return step as WorkflowStep;
}

describe("hourly collection workflow", () => {
  it("runs for database deployments, hourly, or manually", () => {
    expect(workflow.name).toBe("Public web collection");
    expect(workflow.on.push).toEqual({
      branches: ["main"],
      paths: [
        ".github/workflows/hourly-collection.yml",
        "packages/db/migrations/**",
        "packages/db/src/seed-candidates.ts",
        "packages/db/src/seed-run.ts",
        "apps/worker/**",
      ],
    });
    expect(workflow.on.schedule).toEqual([{ cron: "0 */3 * * *" }]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group: "hourly-collection",
      "cancel-in-progress": false,
    });
    expect(collect["runs-on"]).toBe("ubuntu-latest");
    expect(collect["timeout-minutes"]).toBe(30);
  });

  it("keeps only non-sensitive collection limits at job scope", () => {
    expect(collect.env).toEqual({
      VALIDATOR_BASE_URL: "http://127.0.0.1:3001",
      CANDIDATE_LIMIT: "50",
      LISTING_LIMIT: "50",
      WORKER_CONCURRENCY: "4",
      WORKER_DEADLINE_MS: "1500000",
      PUBLIC_SEARCH_MAX_RESULTS: "50",
    });
  });

  it("scopes each secret to only the steps that need it", () => {
    for (const name of [
      "Check out repository",
      "Set up pnpm",
      "Set up Node.js",
      "Install dependencies",
      "Build worker and validator",
    ]) {
      expect(stepNamed(name).env).toBeUndefined();
    }

    expect(stepNamed("Migrate database").env).toEqual({
      DATABASE_URL: "${{ secrets.DATABASE_URL }}",
    });
    expect(stepNamed("Seed database").env).toEqual({
      DATABASE_URL: "${{ secrets.DATABASE_URL }}",
    });
    expect(stepNamed("Run bounded collection").env).toEqual({
      DATABASE_URL: "${{ secrets.DATABASE_URL }}",
      VALIDATOR_SHARED_TOKEN: "${{ secrets.VALIDATOR_SHARED_TOKEN }}",
      BRAVE_SEARCH_API_KEY: "${{ secrets.BRAVE_SEARCH_API_KEY }}",
      GOOGLE_SEARCH_API_KEY: "${{ secrets.GOOGLE_SEARCH_API_KEY }}",
      GOOGLE_SEARCH_CX: "${{ secrets.GOOGLE_SEARCH_CX }}",
      SERPER_API_KEY: "${{ secrets.SERPER_API_KEY }}",
    });

    const serialized = JSON.stringify(workflow);
    expect(serialized).toContain("secrets.DATABASE_URL");
    expect(serialized).toContain("secrets.VALIDATOR_SHARED_TOKEN");
    const secretReferences = collect.steps.flatMap((step) =>
      Object.values(step.env ?? {}).filter((value) => value.includes("secrets.")),
    );
    expect(secretReferences).toHaveLength(8);
    expect(new Set(secretReferences)).toEqual(
      new Set([
        "${{ secrets.DATABASE_URL }}",
        "${{ secrets.VALIDATOR_SHARED_TOKEN }}",
        "${{ secrets.BRAVE_SEARCH_API_KEY }}",
        "${{ secrets.GOOGLE_SEARCH_API_KEY }}",
        "${{ secrets.GOOGLE_SEARCH_CX }}",
        "${{ secrets.SERPER_API_KEY }}",
      ]),
    );
    expect(workflowText).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(serialized).toContain("http://127.0.0.1:3001/health");
    expect(serialized).toContain("pnpm --filter @compare/worker run-once");
  });

  it("pins only approved setup actions to immutable commits", () => {
    const actionUses = collect.steps.flatMap((step) =>
      step.uses ? [step.uses] : [],
    );
    expect(actionUses.map((uses) => uses.split("@")[0])).toEqual([
      "actions/checkout",
      "pnpm/action-setup",
      "actions/setup-node",
    ]);
    for (const uses of actionUses) {
      expect(uses).toMatch(
        /^(?:actions\/checkout|pnpm\/action-setup|actions\/setup-node)@[0-9a-f]{40}$/,
      );
      expect(uses).not.toContain("@v4");
      expect(workflowText).toContain(`uses: ${uses} # v4`);
    }

    expect(stepNamed("Set up Node.js").with).toEqual({
      "node-version": "24",
      cache: "pnpm",
    });
    expect(stepNamed("Set up pnpm").with).toBeUndefined();
    expect(stepNamed("Install dependencies").run).toBe(
      "pnpm install --frozen-lockfile",
    );
  });

  it("builds, prepares the database, polls health, runs once, and cleans up", () => {
    const stepNames = collect.steps.map((step) => step.name);
    const buildIndex = stepNames.indexOf("Build worker and validator");
    const migrateIndex = stepNames.indexOf("Migrate database");
    const seedIndex = stepNames.indexOf("Seed database");
    const collectionIndex = stepNames.indexOf("Run bounded collection");

    expect(buildIndex).toBeGreaterThan(-1);
    expect(migrateIndex).toBeGreaterThan(buildIndex);
    expect(seedIndex).toBeGreaterThan(migrateIndex);
    expect(collectionIndex).toBeGreaterThan(seedIndex);

    const build = stepNamed("Build worker and validator").run;
    expect(build).toContain("pnpm --filter @compare/worker... build");
    expect(build).toContain("pnpm --filter @compare/validator build");
    expect(stepNamed("Migrate database").run).toBe("pnpm db:migrate");
    expect(stepNamed("Seed database").run).toBe("pnpm db:seed");

    const collection = stepNamed("Run bounded collection").run;
    expect(collection).toContain("set -euo pipefail");
    expect(collection).toContain("trap cleanup EXIT");
    expect(collection).toContain("pnpm --filter @compare/validator start");
    expect(collection).toContain("http://127.0.0.1:3001/health");
    expect(collection).toContain("pnpm --filter @compare/worker run-once");
    expect(collection).toContain('worker_pid=""');

    const cleanup = collection?.slice(
      collection.indexOf("cleanup()"),
      collection.indexOf("trap cleanup EXIT"),
    );
    for (const pid of ["worker_pid", "validator_pid"]) {
      expect(cleanup).toContain(`kill "${"${"}${pid}}" 2>/dev/null || true`);
      expect(cleanup).toContain(`wait "${"${"}${pid}}" 2>/dev/null || true`);
    }

    const workerStartIndex = collection?.indexOf(
      "pnpm --filter @compare/worker run-once",
    );
    expect(workerStartIndex).toBeGreaterThan(-1);
    const runtimeMonitor = collection?.slice(workerStartIndex);
    expect(runtimeMonitor).toContain("worker_pid=$!");

    const validatorCheckIndex = runtimeMonitor?.indexOf(
      'if ! kill -0 "${validator_pid}" 2>/dev/null; then',
    );
    const workerCheckIndex = runtimeMonitor?.indexOf(
      'if ! kill -0 "${worker_pid}" 2>/dev/null; then',
    );
    expect(validatorCheckIndex).toBeGreaterThan(-1);
    expect(workerCheckIndex).toBeGreaterThan(validatorCheckIndex ?? -1);
    expect(runtimeMonitor?.slice(validatorCheckIndex, workerCheckIndex)).toContain(
      "exit 1",
    );

    const statusHandling = runtimeMonitor?.slice(workerCheckIndex);
    expect(statusHandling).toContain('if wait "${worker_pid}"; then');
    expect(statusHandling).toContain("worker_status=0");
    expect(statusHandling).toContain("worker_status=$?");
    expect(statusHandling).toContain('exit "${worker_status}"');
    expect(statusHandling).not.toContain(
      'wait "${worker_pid}" 2>/dev/null || true',
    );

    const workerStatusIndex = statusHandling?.indexOf("worker_status=$?") ?? -1;
    expect(statusHandling?.indexOf('kill -0 "${validator_pid}"', workerStatusIndex)).toBeGreaterThan(
      workerStatusIndex,
    );
    expect(collection).not.toContain("DATABASE_URL");
    expect(collection).not.toContain("VALIDATOR_SHARED_TOKEN");
  });

  it("publishes the fixed worker log to the Actions log and job summary", () => {
    const collection = stepNamed("Run bounded collection").run ?? "";
    const publisherStart = collection.indexOf("publish_worker_summary()");
    const cleanupStart = collection.indexOf("cleanup()", publisherStart);

    expect(publisherStart).toBeGreaterThan(-1);
    expect(cleanupStart).toBeGreaterThan(publisherStart);

    const publisher = collection.slice(publisherStart, cleanupStart);
    expect(publisher).toContain(
      'if [[ -s "${RUNNER_TEMP}/worker.log" ]]; then',
    );
    expect(
      publisher.match(/cat "\$\{RUNNER_TEMP\}\/worker\.log"/g),
    ).toHaveLength(2);
    expect(publisher.match(/\bcat\s+/g)).toHaveLength(2);
    expect(publisher).toContain("Worker produced no collection output.");
    expect(publisher).toContain("## Hourly collection");
    expect(publisher).toContain("```text");
    expect(publisher).toContain('${GITHUB_STEP_SUMMARY}');

    expect(collection).not.toMatch(
      /(?:cat|<)\s*"?\$\{RUNNER_TEMP\}\/validator\.log/i,
    );
  });

  it("publishes the summary after wait without replacing the worker status", () => {
    const collection = stepNamed("Run bounded collection").run ?? "";
    const workerStartIndex = collection.indexOf(
      "pnpm --filter @compare/worker run-once",
    );
    const runtimeMonitor = collection.slice(workerStartIndex);
    const workerCheckIndex = runtimeMonitor.indexOf(
      'if ! kill -0 "${worker_pid}" 2>/dev/null; then',
    );
    const statusHandling = runtimeMonitor.slice(workerCheckIndex);

    const waitIndex = statusHandling.indexOf('if wait "${worker_pid}"; then');
    const publishIndex = statusHandling.indexOf(
      "publish_worker_summary || true",
    );
    const failureIndex = statusHandling.indexOf(
      "if (( worker_status != 0 )); then",
    );

    expect(waitIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(waitIndex);
    expect(failureIndex).toBeGreaterThan(publishIndex);
    expect(statusHandling.slice(failureIndex)).toContain(
      'exit "${worker_status}"',
    );
  });
});
