import { getQueueConfig } from "./queue.js";

export interface WorkerConfig {
  validatorBaseUrl: string;
  validatorSharedToken: string;
}

export async function startWorker(config: WorkerConfig): Promise<void> {
  // eslint-disable-next-line no-console
  console.log("Worker starting...");
  const queues = getQueueConfig();
  // eslint-disable-next-line no-console
  console.log(
    `Configured ${queues.length} queues:`,
    queues.map((q) => q.queueName).join(", "),
  );

  // In production: connect to pg-boss and register job handlers
  // For now: log startup
  // eslint-disable-next-line no-console
  console.log("Worker ready. Validator:", config.validatorBaseUrl);

  // Keep process alive
  process.on("SIGTERM", () => {
    // eslint-disable-next-line no-console
    console.log("Worker shutting down...");
    process.exit(0);
  });
}

// Run if main
const isMain = process.argv[1]?.includes("index");
if (isMain) {
  const config: WorkerConfig = {
    validatorBaseUrl: process.env.VALIDATOR_BASE_URL ?? "http://localhost:3001",
    validatorSharedToken: process.env.VALIDATOR_SHARED_TOKEN ?? "dev-token",
  };
  startWorker(config);
}
