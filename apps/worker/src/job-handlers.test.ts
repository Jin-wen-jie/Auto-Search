import { describe, expect, it, vi } from "vitest";
import {
  createJobHandlers,
  type WorkerRepository,
} from "./job-handlers.js";
import { QUEUES } from "./queue.js";
import type { ValidatorResponse } from "./validator-client.js";

const validationResult = {
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
    stockText: "有货",
    stockQuantity: 5,
    buyAction: true,
    pageFingerprint: "page-hash",
    platformLinks: [],
    confidence: { title: 1, price: 1, availability: 1 },
  },
} satisfies ValidatorResponse;

function createRepository(): WorkerRepository {
  return {
    listCandidateIdsForValidation: vi.fn().mockResolvedValue([]),
    getCandidateForValidation: vi.fn().mockResolvedValue({
      id: "candidate-1",
      productUrl: "https://shop.example/item/1",
    }),
    markCandidateValidating: vi.fn().mockResolvedValue(undefined),
    saveCandidateValidation: vi.fn().mockResolvedValue(undefined),
    saveCandidateFailure: vi.fn().mockResolvedValue(undefined),
    saveDiscoveredPlatformLinks: vi.fn().mockResolvedValue([]),
    listListingIdsForRevalidation: vi.fn().mockResolvedValue([]),
    getListingForRevalidation: vi.fn().mockResolvedValue(null),
    saveListingRevalidation: vi.fn().mockResolvedValue(undefined),
  };
}

describe("worker job handlers", () => {
  it("validates a candidate and persists the observation", async () => {
    const repository = createRepository();
    const validate = vi.fn().mockResolvedValue(validationResult);
    const handlers = createJobHandlers({
      repository,
      validate,
      enqueue: vi.fn(),
    });

    await expect(
      handlers.validateCandidate({ candidateId: "candidate-1" }),
    ).resolves.toEqual({ status: "validated" });
    expect(repository.markCandidateValidating).toHaveBeenCalledWith(
      "candidate-1",
    );
    expect(validate).toHaveBeenCalledWith("https://shop.example/item/1");
    expect(repository.saveCandidateValidation).toHaveBeenCalledWith(
      "candidate-1",
      validationResult,
    );
  });

  it("records candidate failures before letting pg-boss retry", async () => {
    const repository = createRepository();
    const failure = new Error("validator unavailable");
    const handlers = createJobHandlers({
      repository,
      validate: vi.fn().mockRejectedValue(failure),
      enqueue: vi.fn(),
    });

    await expect(
      handlers.validateCandidate({ candidateId: "candidate-1" }),
    ).rejects.toThrow("validator unavailable");
    expect(repository.saveCandidateFailure).toHaveBeenCalledWith(
      "candidate-1",
      failure,
    );
  });

  it("enqueues the exact candidate ids inserted from discovered links", async () => {
    const repository = createRepository();
    vi.mocked(repository.saveDiscoveredPlatformLinks).mockResolvedValue(
      ["candidate-new-1", "candidate-new-2"],
    );
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const validate = vi.fn().mockResolvedValue({
      ...validationResult,
      extraction: {
        ...validationResult.extraction,
        platformLinks: [
          "https://shop.example/item/new-1",
          "https://shop.example/item/new-2",
        ],
      },
    });
    const handlers = createJobHandlers({ repository, validate, enqueue });

    await handlers.validateCandidate({ candidateId: "candidate-1" });

    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      QUEUES.VALIDATE_CANDIDATE,
      "candidate-new-1",
    );
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      QUEUES.VALIDATE_CANDIDATE,
      "candidate-new-2",
    );
    expect(repository.listCandidateIdsForValidation).not.toHaveBeenCalled();
  });

  it("sweeps pending candidates into singleton entity jobs", async () => {
    const repository = createRepository();
    vi.mocked(repository.listCandidateIdsForValidation).mockResolvedValue([
      "candidate-1",
      "candidate-2",
    ]);
    const enqueue = vi.fn().mockResolvedValue("job-id");
    const handlers = createJobHandlers({
      repository,
      validate: vi.fn(),
      enqueue,
    });

    await expect(handlers.sweepCandidates()).resolves.toEqual({ queued: 2 });
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      QUEUES.VALIDATE_CANDIDATE,
      "candidate-1",
    );
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      QUEUES.VALIDATE_CANDIDATE,
      "candidate-2",
    );
  });
});
