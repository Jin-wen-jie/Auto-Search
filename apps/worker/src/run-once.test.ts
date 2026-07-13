import { describe, expect, it, vi } from "vitest";
import type { BatchResult } from "./run-batch.js";
import {
  parseRunOnceConfig,
  runOnce,
} from "./run-once.js";
import type { WorkerRepositoryRuntime } from "./worker-repository.js";

const config = parseRunOnceConfig({
  DATABASE_URL: "postgres://worker-db",
  VALIDATOR_SHARED_TOKEN: "shared-token",
});

const successfulResult: BatchResult = {
  candidates: { attempted: 1, succeeded: 1, failed: 0 },
  listings: { attempted: 0, succeeded: 0, failed: 0 },
  timedOut: false,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("runOnce", () => {
  it("awaits repository close after a successful batch", async () => {
    const closing = deferred();
    const close = vi.fn(() => closing.promise);
    const repository = { close } as unknown as WorkerRepositoryRuntime;
    const invocation = runOnce(config, {
      createRepository: () => repository,
      runBatch: vi.fn().mockResolvedValue(successfulResult),
    });
    let settled = false;
    void invocation.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    closing.resolve();

    await expect(invocation).resolves.toEqual(successfulResult);
  });

  it("awaits repository close before propagating a batch failure", async () => {
    const closing = deferred();
    const close = vi.fn(() => closing.promise);
    const repository = { close } as unknown as WorkerRepositoryRuntime;
    const failure = new Error("stable batch failure");
    const invocation = runOnce(config, {
      createRepository: () => repository,
      runBatch: vi.fn().mockRejectedValue(failure),
    });
    let settled = false;
    void invocation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    closing.resolve();

    await expect(invocation).rejects.toBe(failure);
  });
});
