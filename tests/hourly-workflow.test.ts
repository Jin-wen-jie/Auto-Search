import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as YAML from "yaml";

interface WorkflowStep {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
}

interface HourlyWorkflow {
  name: string;
  on: {
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
  it("runs hourly or manually with one bounded collection job", () => {
    expect(workflow.name).toBe("Hourly collection");
    expect(workflow.on.schedule).toEqual([{ cron: "0 * * * *" }]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency).toEqual({
      group: "hourly-collection",
      "cancel-in-progress": false,
    });
    expect(collect["runs-on"]).toBe("ubuntu-latest");
    expect(collect["timeout-minutes"]).toBe(30);
  });

  it("uses only repository secrets plus fixed collection limits", () => {
    expect(collect.env).toEqual({
      DATABASE_URL: "${{ secrets.DATABASE_URL }}",
      VALIDATOR_SHARED_TOKEN: "${{ secrets.VALIDATOR_SHARED_TOKEN }}",
      VALIDATOR_BASE_URL: "http://127.0.0.1:3001",
      CANDIDATE_LIMIT: "50",
      LISTING_LIMIT: "50",
      WORKER_CONCURRENCY: "4",
      WORKER_DEADLINE_MS: "1500000",
    });

    const serialized = JSON.stringify(workflow);
    expect(serialized).toContain("secrets.DATABASE_URL");
    expect(serialized).toContain("secrets.VALIDATOR_SHARED_TOKEN");
    expect(serialized).toContain("http://127.0.0.1:3001/health");
    expect(serialized).toContain("pnpm --filter @compare/worker run-once");
  });

  it("pins setup actions and installs from the frozen lockfile", () => {
    expect(collect.steps.filter((step) => step.uses).map((step) => step.uses)).toEqual([
      "actions/checkout@v4",
      "pnpm/action-setup@v4",
      "actions/setup-node@v4",
    ]);
    expect(stepNamed("Set up Node.js").with).toEqual({
      "node-version": "24",
      cache: "pnpm",
    });
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
    expect(collection).toContain("kill \"${validator_pid}\"");
    expect(collection).toContain("wait \"${validator_pid}\"");
    expect(collection).toContain("exit 1");
    expect(collection).not.toContain("DATABASE_URL");
    expect(collection).not.toContain("VALIDATOR_SHARED_TOKEN");
  });
});
