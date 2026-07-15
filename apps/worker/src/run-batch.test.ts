import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJobHandlers,
  PersistedEntityFailure,
  type WorkerRepository,
} from "./job-handlers.js";
import { QUEUES } from "./queue.js";
import {
  runWorkerBatch,
  type BatchQueue,
} from "./run-batch.js";
import { parseRunOnceConfig } from "./run-once.js";
import {
  validateUrl,
  ValidatorClientError,
  ValidatorInfrastructureError,
  type ValidatorResponse,
} from "./validator-client.js";

type JobHandlers = ReturnType<typeof createJobHandlers>;

const integrationValidationResult = {
  originalUrl: "https://shop.example/item/1",
  finalUrl: "https://shop.example/item/1",
  redirectChain: [],
  httpStatus: 200,
  elapsedMs: 25,
  extraction: {
    title: "GPT K12",
    price: "10.00",
    currency: "CNY",
    availability: "IN_STOCK",
    stockText: "in stock",
    stockQuantity: 5,
    buyAction: true,
    pageFingerprint: "page-hash",
    platformLinks: [],
    confidence: { title: 1, price: 1, availability: 1 },
  },
} satisfies ValidatorResponse;

afterEach(() => {
  vi.unstubAllGlobals();
});

function createRepository(
  overrides: Partial<WorkerRepository> = {},
): WorkerRepository {
  return {
    listCandidateIdsForValidation: async () => [],
    claimCandidateForValidation: async () => ({
      id: "candidate-1",
      productUrl: "https://shop.example/item/1",
      claimedAt: new Date("2026-07-13T00:00:00.000Z"),
    }),
    saveCandidateValidation: async () => ({
      saved: true,
      discoveredIds: [],
    }),
    saveCandidateFailure: async () => true,
    listListingIdsForRevalidation: async () => [],
    getListingForRevalidation: async () => null,
    saveListingRevalidation: async () => undefined,
    ...overrides,
  };
}

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
      (async () => ({
        outcome: "succeeded" as const,
        status: "ACTIVE" as const,
      })),
  };
}

describe("runWorkerBatch", () => {
  it.each([
    ["candidate", "401", () => jsonResponse({ error: "UNAUTHORIZED" }, 401)],
    ["candidate", "connection", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["candidate", "non-JSON", () => new Response("gateway", { status: 502 })],
    ["candidate", "invalid 200", () => jsonResponse({ ok: true }, 200)],
    ["listing", "401", () => jsonResponse({ error: "UNAUTHORIZED" }, 401)],
    ["listing", "connection", () => Promise.reject(new Error("ECONNREFUSED"))],
    ["listing", "non-JSON", () => new Response("gateway", { status: 502 })],
    ["listing", "invalid 200", () => jsonResponse({ ok: true }, 200)],
  ] as const)(
    "rejects %s batches on validator %s without persisting entity failure",
    async (entity, _failure, makeResponse) => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(makeResponse));
      const saveCandidateFailure = vi.fn().mockResolvedValue(true);
      const saveListingRevalidation = vi.fn().mockResolvedValue(undefined);
      const repository = createRepository({
        listCandidateIdsForValidation: async () =>
          entity === "candidate" ? ["candidate-1"] : [],
        listListingIdsForRevalidation: async () =>
          entity === "listing" ? ["listing-1"] : [],
        getListingForRevalidation: async () => ({
          id: "listing-1",
          originalUrl: "https://shop.example/item/1",
          status: "ACTIVE",
          consecutiveFailures: 0,
          lastSuccessAt: null,
        }),
        saveCandidateFailure,
        saveListingRevalidation,
      });

      const failure = await runWorkerBatch({
        createHandlers: (enqueue) =>
          createJobHandlers({
            repository,
            validate: (url) =>
              validateUrl(url, "http://validator.internal", "shared-token"),
            enqueue,
          }),
        candidateLimit: 10,
        listingLimit: 10,
        concurrency: 1,
        deadlineMs: 1_000,
        now: () => 0,
      }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ValidatorInfrastructureError);
      expect(saveCandidateFailure).not.toHaveBeenCalled();
      expect(saveListingRevalidation).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["candidate", "TIMEOUT", 504],
    ["candidate", "FETCH_ERROR", 502],
    ["listing", "TIMEOUT", 504],
    ["listing", "FETCH_ERROR", 502],
  ] as const)(
    "counts %s validator %s as an entity failure",
    async (entity, code, status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(jsonResponse({ error: code, message: code }, status)),
      );
      const saveCandidateFailure = vi.fn().mockResolvedValue(true);
      const saveListingRevalidation = vi.fn().mockResolvedValue(undefined);
      const repository = createRepository({
        listCandidateIdsForValidation: async () =>
          entity === "candidate" ? ["candidate-1"] : [],
        listListingIdsForRevalidation: async () =>
          entity === "listing" ? ["listing-1"] : [],
        getListingForRevalidation: async () => ({
          id: "listing-1",
          originalUrl: "https://shop.example/item/1",
          status: "ACTIVE",
          consecutiveFailures: 0,
          lastSuccessAt: null,
        }),
        saveCandidateFailure,
        saveListingRevalidation,
      });

      const result = await runWorkerBatch({
        createHandlers: (enqueue) =>
          createJobHandlers({
            repository,
            validate: (url) =>
              validateUrl(url, "http://validator.internal", "shared-token"),
            enqueue,
          }),
        candidateLimit: 10,
        listingLimit: 10,
        concurrency: 1,
        deadlineMs: 1_000,
        now: () => 0,
      });

      expect(result[entity === "candidate" ? "candidates" : "listings"])
        .toMatchObject({ attempted: 1, failed: 1 });
      if (entity === "candidate") {
        expect(saveCandidateFailure).toHaveBeenCalledOnce();
      } else {
        expect(saveListingRevalidation).toHaveBeenCalledOnce();
      }
    },
  );
  it.each([
    ["candidateLimit", 0],
    ["candidateLimit", -1],
    ["candidateLimit", 1.5],
    ["candidateLimit", Number.NaN],
    ["candidateLimit", Number.POSITIVE_INFINITY],
    ["candidateLimit", Number.MAX_SAFE_INTEGER + 1],
    ["listingLimit", 0],
    ["listingLimit", -1],
    ["listingLimit", 1.5],
    ["listingLimit", Number.NaN],
    ["listingLimit", Number.POSITIVE_INFINITY],
    ["listingLimit", Number.MAX_SAFE_INTEGER + 1],
    ["concurrency", 0],
    ["concurrency", -1],
    ["concurrency", 1.5],
    ["concurrency", Number.NaN],
    ["concurrency", Number.POSITIVE_INFINITY],
    ["concurrency", Number.MAX_SAFE_INTEGER + 1],
    ["deadlineMs", 0],
    ["deadlineMs", -1],
    ["deadlineMs", 1.5],
    ["deadlineMs", Number.NaN],
    ["deadlineMs", Number.POSITIVE_INFINITY],
    ["deadlineMs", Number.MAX_SAFE_INTEGER + 1],
  ] as const)("rejects invalid %s=%s", async (name, value) => {
    let factoryCalled = false;
    const options = {
      createHandlers: (enqueue: (queue: BatchQueue, id: string) => Promise<void>) => {
        factoryCalled = true;
        return createHandlers(enqueue);
      },
      candidateLimit: 50,
      listingLimit: 50,
      concurrency: 4,
      deadlineMs: 1_000,
      now: () => 0,
    };

    await expect(
      runWorkerBatch({ ...options, [name]: value }),
    ).rejects.toThrow(`${name} must be a positive safe integer`);
    expect(factoryCalled).toBe(false);
  });

  it("rejects concurrency above the batch maximum", async () => {
    await expect(
      runWorkerBatch({
        createHandlers: (enqueue) => createHandlers(enqueue),
        candidateLimit: 50,
        listingLimit: 50,
        concurrency: 17,
        deadlineMs: 1_000,
        now: () => 0,
      }),
    ).rejects.toThrow("concurrency must not exceed 16");
  });

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
            return { outcome: "succeeded", status: "ACTIVE" };
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
            throw new PersistedEntityFailure();
          },
          revalidateListing: async ({ listingId }) => {
            attemptedListings.push(listingId);
            if (listingId === "listing-1") {
              return { outcome: "failed", status: "RECHECK" };
            }
            return { outcome: "succeeded", status: "ACTIVE" };
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

  it.each(["claim", "save"] as const)(
    "rejects when candidate repository %s fails",
    async (operation) => {
      const failure = new Error(`candidate repository ${operation} failed`);
      const repository = createRepository({
        listCandidateIdsForValidation: async () => ["candidate-1"],
        ...(operation === "claim"
          ? { claimCandidateForValidation: async () => Promise.reject(failure) }
          : { saveCandidateValidation: async () => Promise.reject(failure) }),
      });

      await expect(
        runWorkerBatch({
          createHandlers: (enqueue) =>
            createJobHandlers({
              repository,
              validate: async () => integrationValidationResult,
              enqueue,
            }),
          candidateLimit: 10,
          listingLimit: 10,
          concurrency: 1,
          deadlineMs: 1_000,
          now: () => 0,
        }),
      ).rejects.toBe(failure);
    },
  );

  it("counts a persisted listing timeout as an entity failure", async () => {
    const repository = createRepository({
      listListingIdsForRevalidation: async () => ["listing-1"],
      getListingForRevalidation: async () => ({
        id: "listing-1",
        originalUrl: "https://shop.example/item/1",
        status: "ACTIVE",
        consecutiveFailures: 0,
        lastSuccessAt: null,
      }),
    });

    await expect(
      runWorkerBatch({
        createHandlers: (enqueue) =>
          createJobHandlers({
            repository,
            validate: async () =>
              Promise.reject(new ValidatorClientError("TIMEOUT", "TIMEOUT")),
            enqueue,
          }),
        candidateLimit: 10,
        listingLimit: 10,
        concurrency: 1,
        deadlineMs: 1_000,
        now: () => 0,
      }),
    ).resolves.toEqual({
      candidates: { attempted: 0, succeeded: 0, failed: 0 },
      listings: { attempted: 1, succeeded: 0, failed: 1 },
      timedOut: false,
    });
  });

  it("drains active work and throws the first fatal error", async () => {
    const firstFailure = new Error("repository get failed");
    const secondFailure = new Error("repository save failed");
    const started: string[] = [];
    let notifyActiveStarted!: () => void;
    let releaseActive!: () => void;
    let activeFinished = false;
    const activeStarted = new Promise<void>((resolve) => {
      notifyActiveStarted = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseActive = resolve;
    });
    const batch = runWorkerBatch({
      createHandlers: (enqueue) =>
        createHandlers(enqueue, {
          candidateIds: ["fatal", "active", "queued"],
          validateCandidate: async ({ candidateId }) => {
            started.push(candidateId);
            if (candidateId === "fatal") {
              await activeStarted;
              throw firstFailure;
            }
            if (candidateId === "active") {
              notifyActiveStarted();
              try {
                await release;
                throw secondFailure;
              } finally {
                activeFinished = true;
              }
            }
            return { status: "validated" };
          },
        }),
      candidateLimit: 10,
      listingLimit: 10,
      concurrency: 2,
      deadlineMs: 1_000,
      now: () => 0,
    });
    let settled = false;
    void batch.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await activeStarted;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedBeforeRelease = [...started];
    const settledBeforeRelease = settled;
    releaseActive();

    await expect(batch).rejects.toBe(firstFailure);
    expect(startedBeforeRelease).toEqual(["fatal", "active"]);
    expect(settledBeforeRelease).toBe(false);
    expect(activeFinished).toBe(true);
    expect(started).not.toContain("queued");
  });

  it.each(["candidates", "listings"] as const)(
    "propagates %s sweep failures before starting entity work",
    async (queue) => {
      const failure = new Error(`${queue} sweep failed`);
      const validateCandidate = async () => ({ status: "validated" as const });
      const revalidateListing = async () => ({
        outcome: "succeeded" as const,
        status: "ACTIVE" as const,
      });

      await expect(
        runWorkerBatch({
          createHandlers: () => ({
            sweepCandidates: queue === "candidates"
              ? async () => Promise.reject(failure)
              : async () => ({ queued: 0 }),
            validateCandidate,
            sweepListings: queue === "listings"
              ? async () => Promise.reject(failure)
              : async () => ({ queued: 0 }),
            revalidateListing,
          }),
          candidateLimit: 10,
          listingLimit: 10,
          concurrency: 2,
          deadlineMs: 1_000,
          now: () => 0,
        }),
      ).rejects.toBe(failure);
    },
  );
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
      publicSearch: {
        braveApiKey: undefined,
        googleApiKey: undefined,
        googleCx: undefined,
        serperApiKey: undefined,
        maxResults: 50,
      },
    });
  });

  it("accepts positive integer overrides", () => {
    expect(
      parseRunOnceConfig({
        ...requiredEnv,
        VALIDATOR_BASE_URL: "http://validator.internal:4000",
        CANDIDATE_LIMIT: "12",
        LISTING_LIMIT: "34",
        WORKER_CONCURRENCY: "16",
        WORKER_DEADLINE_MS: "90000",
        BRAVE_SEARCH_API_KEY: " brave-key ",
        GOOGLE_SEARCH_API_KEY: "google-key",
        GOOGLE_SEARCH_CX: "google-cx",
        SERPER_API_KEY: "serper-key",
        PUBLIC_SEARCH_MAX_RESULTS: "25",
      }),
    ).toEqual({
      databaseUrl: "postgres://worker-db",
      validatorBaseUrl: "http://validator.internal:4000",
      validatorSharedToken: "shared-token",
      candidateLimit: 12,
      listingLimit: 34,
      concurrency: 16,
      deadlineMs: 90_000,
      publicSearch: {
        braveApiKey: "brave-key",
        googleApiKey: "google-key",
        googleCx: "google-cx",
        serperApiKey: "serper-key",
        maxResults: 25,
      },
    });
  });

  it("rejects worker concurrency above the CLI maximum", () => {
    expect(() =>
      parseRunOnceConfig({
        ...requiredEnv,
        WORKER_CONCURRENCY: "17",
      })
    ).toThrow("WORKER_CONCURRENCY must not exceed 16");
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
    ["CANDIDATE_LIMIT", "9007199254740992"],
    ["LISTING_LIMIT", "0"],
    ["LISTING_LIMIT", "-1"],
    ["LISTING_LIMIT", "1.5"],
    ["LISTING_LIMIT", "many"],
    ["LISTING_LIMIT", "9007199254740992"],
    ["WORKER_CONCURRENCY", "0"],
    ["WORKER_CONCURRENCY", "-1"],
    ["WORKER_CONCURRENCY", "1.5"],
    ["WORKER_CONCURRENCY", "many"],
    ["WORKER_CONCURRENCY", "9007199254740992"],
    ["WORKER_DEADLINE_MS", "0"],
    ["WORKER_DEADLINE_MS", "-1"],
    ["WORKER_DEADLINE_MS", "1.5"],
    ["WORKER_DEADLINE_MS", "many"],
    ["WORKER_DEADLINE_MS", "9007199254740992"],
    ["PUBLIC_SEARCH_MAX_RESULTS", "0"],
    ["PUBLIC_SEARCH_MAX_RESULTS", "-1"],
    ["PUBLIC_SEARCH_MAX_RESULTS", "1.5"],
    ["PUBLIC_SEARCH_MAX_RESULTS", "many"],
    ["PUBLIC_SEARCH_MAX_RESULTS", "9007199254740992"],
  ])("rejects %s=%s", (name, value) => {
    expect(() =>
      parseRunOnceConfig({ ...requiredEnv, [name]: value })
    ).toThrow(`${name} must be a positive integer`);
  });
});
