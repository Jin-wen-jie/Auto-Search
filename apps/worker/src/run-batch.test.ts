import { describe, expect, it } from "vitest";
import type { createJobHandlers } from "./job-handlers.js";
import { QUEUES } from "./queue.js";
import {
  runWorkerBatch,
  type BatchQueue,
} from "./run-batch.js";
import { parseRunOnceConfig } from "./run-once.js";

type JobHandlers = ReturnType<typeof createJobHandlers>;

function createHandlers(
  enqueue: (queue: BatchQueue, id: string) => Promise<void>,
  options: {
    candidateIds?: string[];
    listingIds?: string[];
    validateCandidate?: JobHandlers["validateCandidate"];
    revalidateListing?: JobHandlers["revalidateListing"];
  } = {},
): JobHandlers {
  const candidateIds = options.candidateIds ?? [];
  const listingIds = options.listingIds ?? [];

  return {
    async sweepCandidates() {
      await Promise.all(
        candidateIds.map((id) =>
          enqueue(QUEUES.VALIDATE_CANDIDATE, id),
        ),
      );
      return { queued: candidateIds.length };
    },
    validateCandidate: options.validateCandidate ??
      (async () => ({ status: "validated" as const })),
    async sweepListings() {
      await Promise.all(
        listingIds.map((id) =>
          enqueue(QUEUES.REVALIDATE_LISTING, id),
        ),
      );
      return { queued: listingIds.length };
    },
    revalidateListing: options.revalidateListing ??
      (async () => ({ status: "ACTIVE" as const })),
  };
}

describe("runWorkerBatch", () => {
  it("caps attempts at the candidate and listing limits", async () => {
    const candidateIds = Array.from(
      { length: 60 },
      (_, index) => `candidate-${index}`,
    );
    const listingIds = Array.from(
      { length: 60 },
      (_, index) => `listing-${index}`,
    );

    await expect(
      runWorkerBatch({
        createHandlers: (enqueue) =>
          createHandlers(enqueue, { candidateIds, listingIds }),
        candidateLimit: 50,
        listingLimit: 50,
        concurrency: 4,
        deadlineMs: 1_000,
        now: () => 0,
      }),
    ).resolves.toEqual({
      candidates: { attempted: 50, succeeded: 50, failed: 0 },
      listings: { attempted: 50, succeeded: 50, failed: 0 },
      timedOut: false,
    });
  });

  it("enforces one global concurrency limit across both entity queues", async () => {
    let active = 0;
    let peak = 0;
    const processEntity = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    };

    await runWorkerBatch({
      createHandlers: (enqueue) =>
        createHandlers(enqueue, {
          candidateIds: Array.from(
            { length: 8 },
            (_, index) => `candidate-${index}`,
          ),
          listingIds: Array.from(
            { length: 8 },
            (_, index) => `listing-${index}`,
          ),
          validateCandidate: async () => {
            await processEntity();
            return { status: "validated" };
          },
          revalidateListing: async () => {
            await processEntity();
            return { status: "ACTIVE" };
          },
        }),
      candidateLimit: 50,
      listingLimit: 50,
      concurrency: 4,
      deadlineMs: 1_000,
      now: () => 0,
    });

    expect(peak).toBe(4);
  });

  it("keeps idle worker loops available for dynamically enqueued ids", async () => {
    let enqueueCandidate: ((id: string) => Promise<void>) | undefined;
    let dynamicStarted = 0;
    let notifyFirstDynamic!: () => void;
    let releaseDynamic!: () => void;
    const firstDynamicStarted = new Promise<void>((resolve) => {
      notifyFirstDynamic = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseDynamic = resolve;
    });

    const batch = runWorkerBatch({
      createHandlers: (enqueue) => {
        enqueueCandidate = (id) =>
          enqueue(QUEUES.VALIDATE_CANDIDATE, id);
        return createHandlers(enqueue, {
          candidateIds: ["candidate-root"],
          validateCandidate: async ({ candidateId }) => {
            if (candidateId === "candidate-root") {
              await enqueueCandidate?.("candidate-1");
              await enqueueCandidate?.("candidate-2");
              await enqueueCandidate?.("candidate-3");
              return { status: "validated" };
            }
            dynamicStarted++;
            if (dynamicStarted === 1) notifyFirstDynamic();
            await release;
            return { status: "validated" };
          },
        });
      },
      candidateLimit: 10,
      listingLimit: 10,
      concurrency: 3,
      deadlineMs: 1_000,
      now: () => 0,
    });

    await firstDynamicStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedBeforeRelease = dynamicStarted;
    releaseDynamic();

    await expect(batch).resolves.toEqual({
      candidates: { attempted: 4, succeeded: 4, failed: 0 },
      listings: { attempted: 0, succeeded: 0, failed: 0 },
      timedOut: false,
    });
    expect(startedBeforeRelease).toBe(3);
  });

  it("isolates failures and consumes dynamically enqueued deduplicated ids", async () => {
    const attemptedCandidates: string[] = [];
    const attemptedListings: string[] = [];
    let enqueueCandidate: ((id: string) => Promise<void>) | undefined;

    const result = await runWorkerBatch({
      createHandlers: (enqueue) => {
        enqueueCandidate = (id) =>
          enqueue(QUEUES.VALIDATE_CANDIDATE, id);
        return createHandlers(enqueue, {
          candidateIds: ["candidate-1", "candidate-1"],
          listingIds: ["listing-1", "listing-2", "listing-2"],
          validateCandidate: async ({ candidateId }) => {
            attemptedCandidates.push(candidateId);
            if (candidateId === "candidate-1") {
              await Promise.resolve();
              await enqueueCandidate?.("candidate-2");
              await enqueueCandidate?.("candidate-2");
              return { status: "validated" };
            }
            throw new Error("stable candidate failure category");
          },
          revalidateListing: async ({ listingId }) => {
            attemptedListings.push(listingId);
            if (listingId === "listing-1") {
              throw new Error("stable listing failure category");
            }
            return { status: "ACTIVE" };
          },
        });
      },
      candidateLimit: 3,
      listingLimit: 3,
      concurrency: 2,
      deadlineMs: 1_000,
      now: () => 0,
    });

    expect(attemptedCandidates).toEqual(["candidate-1", "candidate-2"]);
    expect(attemptedListings).toEqual(["listing-1", "listing-2"]);
    expect(result).toEqual({
      candidates: { attempted: 2, succeeded: 1, failed: 1 },
      listings: { attempted: 2, succeeded: 1, failed: 1 },
      timedOut: false,
    });
  });

  it("does not start queued work at the deadline and lets active work finish", async () => {
    let currentTime = 0;
    let startedCount = 0;
    let notifyStarted!: () => void;
    let releaseActive!: () => void;
    const bothStarted = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const attemptedCandidates: string[] = [];

    const batch = runWorkerBatch({
      createHandlers: (enqueue) =>
        createHandlers(enqueue, {
          candidateIds: ["candidate-1", "candidate-2", "candidate-3"],
          validateCandidate: async ({ candidateId }) => {
            attemptedCandidates.push(candidateId);
            startedCount++;
            if (startedCount === 2) notifyStarted();
            await release;
            return { status: "validated" };
          },
        }),
      candidateLimit: 50,
      listingLimit: 50,
      concurrency: 2,
      deadlineMs: 100,
      now: () => currentTime,
    });

    await bothStarted;
    currentTime = 100;
    releaseActive();

    await expect(batch).resolves.toEqual({
      candidates: { attempted: 2, succeeded: 2, failed: 0 },
      listings: { attempted: 0, succeeded: 0, failed: 0 },
      timedOut: true,
    });
    expect(attemptedCandidates).toEqual(["candidate-1", "candidate-2"]);
  });
});

describe("parseRunOnceConfig", () => {
  const requiredEnv = {
    DATABASE_URL: "postgres://worker-db",
    VALIDATOR_SHARED_TOKEN: "shared-token",
  };

  it("uses the production defaults", () => {
    expect(parseRunOnceConfig(requiredEnv)).toEqual({
      databaseUrl: "postgres://worker-db",
      validatorBaseUrl: "http://127.0.0.1:3001",
      validatorSharedToken: "shared-token",
      candidateLimit: 50,
      listingLimit: 50,
      concurrency: 4,
      deadlineMs: 1_500_000,
    });
  });

  it("accepts positive integer overrides", () => {
    expect(
      parseRunOnceConfig({
        ...requiredEnv,
        VALIDATOR_BASE_URL: "http://validator.internal:4000",
        CANDIDATE_LIMIT: "12",
        LISTING_LIMIT: "34",
        WORKER_CONCURRENCY: "6",
        WORKER_DEADLINE_MS: "90000",
      }),
    ).toEqual({
      databaseUrl: "postgres://worker-db",
      validatorBaseUrl: "http://validator.internal:4000",
      validatorSharedToken: "shared-token",
      candidateLimit: 12,
      listingLimit: 34,
      concurrency: 6,
      deadlineMs: 90_000,
    });
  });

  it("requires the database URL and validator token", () => {
    expect(() => parseRunOnceConfig({})).toThrow("DATABASE_URL is required");
    expect(() =>
      parseRunOnceConfig({ DATABASE_URL: "postgres://worker-db" })
    ).toThrow("VALIDATOR_SHARED_TOKEN is required");
  });

  it.each([
    ["CANDIDATE_LIMIT", "0"],
    ["CANDIDATE_LIMIT", "-1"],
    ["CANDIDATE_LIMIT", "1.5"],
    ["CANDIDATE_LIMIT", "many"],
    ["LISTING_LIMIT", "0"],
    ["LISTING_LIMIT", "-1"],
    ["LISTING_LIMIT", "1.5"],
    ["LISTING_LIMIT", "many"],
    ["WORKER_CONCURRENCY", "0"],
    ["WORKER_CONCURRENCY", "-1"],
    ["WORKER_CONCURRENCY", "1.5"],
    ["WORKER_CONCURRENCY", "many"],
    ["WORKER_DEADLINE_MS", "0"],
    ["WORKER_DEADLINE_MS", "-1"],
    ["WORKER_DEADLINE_MS", "1.5"],
    ["WORKER_DEADLINE_MS", "many"],
  ])("rejects %s=%s", (name, value) => {
    expect(() =>
      parseRunOnceConfig({ ...requiredEnv, [name]: value })
    ).toThrow(`${name} must be a positive integer`);
  });
});
