import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createJobHandlers } from "./job-handlers.js";
import {
  runWorkerBatch,
  type BatchResult,
} from "./run-batch.js";
import { validateUrl } from "./validator-client.js";
import {
  createWorkerRepository,
  type WorkerRepositoryRuntime,
} from "./worker-repository.js";

interface RunOnceConfig {
  databaseUrl: string;
  validatorBaseUrl: string;
  validatorSharedToken: string;
  candidateLimit: number;
  listingLimit: number;
  concurrency: number;
  deadlineMs: number;
}

class RunOnceConfigError extends Error {}

interface RunOnceDependencies {
  createRepository: (databaseUrl: string) => WorkerRepositoryRuntime;
  runBatch: typeof runWorkerBatch;
}

export function parseRunOnceConfig(
  env: Readonly<NodeJS.ProcessEnv>,
): RunOnceConfig {
  return {
    databaseUrl: requireValue(env, "DATABASE_URL"),
    validatorBaseUrl:
      env.VALIDATOR_BASE_URL ?? "http://127.0.0.1:3001",
    validatorSharedToken: requireValue(env, "VALIDATOR_SHARED_TOKEN"),
    candidateLimit: positiveInteger(env, "CANDIDATE_LIMIT", 50),
    listingLimit: positiveInteger(env, "LISTING_LIMIT", 50),
    concurrency: positiveInteger(env, "WORKER_CONCURRENCY", 4),
    deadlineMs: positiveInteger(env, "WORKER_DEADLINE_MS", 1_500_000),
  };
}

function requireValue(
  env: Readonly<NodeJS.ProcessEnv>,
  name: "DATABASE_URL" | "VALIDATOR_SHARED_TOKEN",
): string {
  const value = env[name];
  if (!value?.trim()) {
    throw new RunOnceConfigError(`${name} is required`);
  }
  return value;
}

function positiveInteger(
  env: Readonly<NodeJS.ProcessEnv>,
  name:
    | "CANDIDATE_LIMIT"
    | "LISTING_LIMIT"
    | "WORKER_CONCURRENCY"
    | "WORKER_DEADLINE_MS",
  defaultValue: number,
): number {
  const rawValue = env[name];
  if (rawValue === undefined) return defaultValue;

  const value = Number(rawValue);
  if (!/^\d+$/.test(rawValue) || !Number.isSafeInteger(value) || value <= 0) {
    throw new RunOnceConfigError(`${name} must be a positive integer`);
  }
  return value;
}

export async function runOnce(
  config: RunOnceConfig,
  dependencies: Partial<RunOnceDependencies> = {},
): Promise<BatchResult> {
  const createRepository = dependencies.createRepository ??
    createWorkerRepository;
  const runBatch = dependencies.runBatch ?? runWorkerBatch;
  const repository = createRepository(config.databaseUrl);

  try {
    return await runBatch({
      createHandlers: (enqueue) =>
        createJobHandlers({
          repository,
          validate: (url) =>
            validateUrl(
              url,
              config.validatorBaseUrl,
              config.validatorSharedToken,
            ),
          enqueue,
        }),
      candidateLimit: config.candidateLimit,
      listingLimit: config.listingLimit,
      concurrency: config.concurrency,
      deadlineMs: config.deadlineMs,
    });
  } finally {
    await repository.close();
  }
}

async function main(): Promise<void> {
  try {
    const result = await runOnce(parseRunOnceConfig(process.env));
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof RunOnceConfigError
      ? error.message
      : "WORKER_BATCH_FAILED";
    // eslint-disable-next-line no-console
    console.error(message);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  pathToFileURL(resolve(entryPath)).href === import.meta.url
) {
  await main();
}
