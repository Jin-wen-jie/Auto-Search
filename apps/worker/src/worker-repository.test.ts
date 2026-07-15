import {
  createDb,
  candidateObservations,
  discoveryCandidates,
  discoveryEvents,
  linkChecks,
  watchSources,
  type Db,
} from "@compare/db";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerRepository,
  createWorkerRepositoryFromDb,
  classifyCandidateChange,
  isK12AbovePriceLimit,
  mergeCandidateExtraction,
} from "./worker-repository.js";
import type { ValidatorResponse } from "./validator-client.js";
import { ValidatorClientError } from "./validator-client.js";

const CANDIDATE_VALIDATION_LEASE_MS = 5 * 60 * 1_000;
const repositoryValidationResult = {
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

vi.mock("@compare/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@compare/db")>();
  return { ...actual, createDb: vi.fn() };
});

describe("worker repository mappings", () => {
  it("classifies price drops, restocks, and suspicious jumps", () => {
    expect(classifyCandidateChange(
      { price: 1.2, availability: "OUT_OF_STOCK" },
      { price: 1.05, availability: "IN_STOCK" },
    )).toMatchObject({
      anomalous: false,
      priceDropped: true,
      restocked: true,
    });
    expect(classifyCandidateChange(
      { price: 1 },
      { price: 2 },
    )).toMatchObject({ anomalous: true, priceDropped: false });
  });

  it.each([
    [{ focus: "K12", totalPrice: "1.21", price: "1.00" }, true],
    [{ focus: "K12", totalPrice: 1.2, price: "9.00" }, false],
    [{ focus: "K12", price: "1.21" }, true],
    [{ focus: "Bug Team", totalPrice: 99 }, false],
  ] as const)(
    "applies the K12 price limit to effective price %#",
    (extraction, expected) => {
      expect(isK12AbovePriceLimit({ ...extraction })).toBe(expected);
    },
  );

  it("rejects a validated K12 candidate above CNY 1.20", async () => {
    const harness = createCandidateSaveHarness(
      undefined,
      { focus: "K12", totalPrice: "1.21" },
    );
    const repository = createWorkerRepositoryFromDb(harness.db);

    await expect(repository.saveCandidateValidation(
      "candidate-1",
      repositoryValidationResult,
      new Date("2026-07-13T00:00:00.000Z"),
    )).resolves.toMatchObject({ saved: true });

    expect(harness.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "REJECTED",
      rejectionReason: "K12_PRICE_ABOVE_LIMIT",
    }));
  });

  it("claims candidates with one conditional update returning the winner", async () => {
    const returning = vi.fn().mockResolvedValue([{
      id: "candidate-1",
      productUrl: "https://shop.example/item/1",
      claimedAt: new Date("2026-07-13T00:10:00.000Z"),
    }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const select = vi.fn();
    const db = { update, select } as unknown as Db;
    const now = new Date("2026-07-13T00:10:00.000Z");
    const repository = createWorkerRepositoryFromDb(db, {
      now: () => now,
      candidateLeaseMs: CANDIDATE_VALIDATION_LEASE_MS,
    });

    await expect(
      repository.claimCandidateForValidation("candidate-1"),
    ).resolves.toEqual({
      id: "candidate-1",
      productUrl: "https://shop.example/item/1",
      claimedAt: new Date("2026-07-13T00:10:00.000Z"),
    });

    expect(update).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith({ status: "VALIDATING", updatedAt: now });
    expect(returning).toHaveBeenCalledWith({
      id: discoveryCandidates.id,
      productUrl: discoveryCandidates.productUrl,
      claimedAt: discoveryCandidates.updatedAt,
    });
    expectSqlCondition(where.mock.calls[0]?.[0], {
      sql: expect.stringMatching(
        /"id" = \$1.*"status" in \(\$2, \$3\).*"status" = \$4.*"updated_at" < \$5/s,
      ),
      params: [
        "candidate-1",
        "DISCOVERED",
        "RETRY_WAIT",
        "VALIDATING",
        "2026-07-13T00:05:00.000Z",
      ],
    });
  });

  it.each(["success", "failure"] as const)(
    "rejects a stale candidate %s save with the lease fencing condition",
    async (outcome) => {
      const limit = vi.fn().mockResolvedValue([{ extractionResult: {} }]);
      const selectWhere = vi.fn().mockReturnValue({ limit });
      const from = vi.fn().mockReturnValue({ where: selectWhere });
      const select = vi.fn().mockReturnValue({ from });
      const returning = vi.fn().mockResolvedValue([]);
      const updateWhere = vi.fn().mockReturnValue({ returning });
      const set = vi.fn().mockReturnValue({ where: updateWhere });
      const update = vi.fn().mockReturnValue({ set });
      const values = vi.fn().mockResolvedValue(undefined);
      const insert = vi.fn().mockReturnValue({ values });
      const tx = { select, update, insert };
      const db = {
        transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) =>
          operation(tx)),
      } as unknown as Db;
      const repository = createWorkerRepositoryFromDb(db);
      const claimedAt = new Date("2026-07-13T00:00:00.000Z");

      const saved = outcome === "success"
        ? await repository.saveCandidateValidation(
          "candidate-1",
          validationWithPlatformLinks([
            "https://pay.ldxp.cn/item/stale-owner",
          ]),
          claimedAt,
        )
        : await repository.saveCandidateFailure(
          "candidate-1",
          new ValidatorClientError("TIMEOUT", "TIMEOUT"),
          claimedAt,
        );

      if (outcome === "success") {
        expect(saved).toEqual({ saved: false, discoveredIds: [] });
      } else {
        expect(saved).toBe(false);
      }
      expect(insert).not.toHaveBeenCalled();
      expect(returning).toHaveBeenCalledOnce();
      expectSqlCondition(updateWhere.mock.calls[0]?.[0], {
        sql: expect.stringMatching(
          /"id" = \$1.*"status" = \$2.*"updated_at" = \$3/s,
        ),
        params: [
          "candidate-1",
          "VALIDATING",
          "2026-07-13T00:00:00.000Z",
        ],
      });
    },
  );

  it("rolls back candidate completion when the second discovery insert fails", async () => {
    const discoveryFailure = new Error("second discovery insert failed");
    let persistedStatus = "VALIDATING";
    let pendingStatus = persistedStatus;
    let rolledBack = false;
    const limit = vi.fn().mockResolvedValue([{ extractionResult: {} }]);
    const selectWhere = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from });
    const updateReturning = vi.fn().mockResolvedValue([{ id: "candidate-1" }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const set = vi.fn((value: { status: string }) => {
      pendingStatus = value.status;
      return { where: updateWhere };
    });
    const update = vi.fn().mockReturnValue({ set });
    const linkCheckValues = vi.fn().mockResolvedValue(undefined);
    const discoveryReturning = vi.fn()
      .mockResolvedValueOnce([{ id: "candidate-new-1" }])
      .mockRejectedValueOnce(discoveryFailure);
    const onConflictDoNothing = vi.fn().mockReturnValue({
      returning: discoveryReturning,
    });
    const discoveryValues = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn((table: unknown) =>
      table === linkChecks
        ? { values: linkCheckValues }
        : { values: discoveryValues });
    const tx = { select, update, insert };
    const transaction = vi.fn(async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      try {
        const result = await operation(tx);
        persistedStatus = pendingStatus;
        return result;
      } catch (error) {
        pendingStatus = persistedStatus;
        rolledBack = true;
        throw error;
      }
    });
    const repository = createWorkerRepositoryFromDb({
      transaction,
    } as unknown as Db);
    const result = {
      ...repositoryValidationResult,
      extraction: {
        ...repositoryValidationResult.extraction,
        platformLinks: [
          "https://pay.ldxp.cn/item/new-1",
          "https://pay.ldxp.cn/item/new-2",
        ],
      },
    } satisfies ValidatorResponse;

    await expect(repository.saveCandidateValidation(
      "candidate-1",
      result,
      new Date("2026-07-13T00:00:00.000Z"),
    )).rejects.toBe(discoveryFailure);

    expect(transaction).toHaveBeenCalledOnce();
    expect(discoveryReturning).toHaveBeenCalledTimes(2);
    expect(rolledBack).toBe(true);
    expect(persistedStatus).toBe("VALIDATING");
  });

  it("returns exactly the conflict-safe discovered ids from the candidate transaction", async () => {
    const limit = vi.fn().mockResolvedValue([{ extractionResult: {} }]);
    const selectWhere = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    const select = vi.fn().mockReturnValue({ from });
    const updateReturning = vi.fn().mockResolvedValue([{ id: "candidate-1" }]);
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    const update = vi.fn().mockReturnValue({ set });
    const linkCheckValues = vi.fn().mockResolvedValue(undefined);
    const discoveryReturning = vi.fn()
      .mockResolvedValueOnce([{ id: "candidate-new-1" }])
      .mockResolvedValueOnce([{ id: "candidate-new-2" }]);
    const onConflictDoNothing = vi.fn().mockReturnValue({
      returning: discoveryReturning,
    });
    const discoveryValues = vi.fn().mockReturnValue({ onConflictDoNothing });
    const insert = vi.fn((table: unknown) =>
      table === linkChecks
        ? { values: linkCheckValues }
        : { values: discoveryValues });
    const tx = { select, update, insert };
    const repository = createWorkerRepositoryFromDb({
      transaction: vi.fn(async (
        operation: (transaction: typeof tx) => Promise<unknown>,
      ) => operation(tx)),
    } as unknown as Db);
    const result = {
      ...repositoryValidationResult,
      extraction: {
        ...repositoryValidationResult.extraction,
        platformLinks: [
          "https://pay.ldxp.cn/item/new-1#first",
          "https://pay.ldxp.cn/item/new-1#duplicate",
          "https://store.codesky.qzz.io/item/new-2",
        ],
      },
    } satisfies ValidatorResponse;

    await expect(repository.saveCandidateValidation(
      "candidate-1",
      result,
      new Date("2026-07-13T00:00:00.000Z"),
    )).resolves.toEqual({
      saved: true,
      discoveredIds: ["candidate-new-1", "candidate-new-2"],
    });
    expect(discoveryReturning).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it("lists pending and expired validating candidates but excludes fresh leases", async () => {
    const limit = vi.fn().mockResolvedValue([
      { id: "candidate-pending" },
      { id: "candidate-expired" },
    ]);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const db = { select } as unknown as Db;
    const repository = createWorkerRepositoryFromDb(db, {
      now: () => new Date("2026-07-13T00:10:00.000Z"),
      candidateLeaseMs: CANDIDATE_VALIDATION_LEASE_MS,
    });

    await expect(repository.listCandidateIdsForValidation()).resolves.toEqual([
      "candidate-pending",
      "candidate-expired",
    ]);
    expectSqlCondition(where.mock.calls[0]?.[0], {
      sql: expect.stringMatching(
        /"status" in \(\$1, \$2\).*"status" = \$3.*"updated_at" < \$4/s,
      ),
      params: [
        "DISCOVERED",
        "RETRY_WAIT",
        "VALIDATING",
        "2026-07-13T00:05:00.000Z",
      ],
    });
  });

  it("awaits closing the underlying postgres client", async () => {
    let finishClosing!: () => void;
    const end = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishClosing = resolve;
        }),
    );
    vi.mocked(createDb).mockReturnValue({ $client: { end } } as never);
    const repository = createWorkerRepository("postgres://worker-db");
    expect(createDb).toHaveBeenCalledWith("postgres://worker-db", {
      maxConnections: 4,
      idleTimeoutSeconds: 5,
    });

    const closing = repository.close();
    let settled = false;
    void closing.then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(end).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    finishClosing();
    await closing;
    expect(settled).toBe(true);
  });

  it("returns only ids won by conflict-safe discovered-link inserts", async () => {
    const returning = vi.fn()
      .mockResolvedValueOnce([{ id: "candidate-winner" }])
      .mockResolvedValueOnce([]);
    const harness = createCandidateSaveHarness(returning);
    const repository = createWorkerRepositoryFromDb(harness.db);
    const result = validationWithPlatformLinks([
      "https://pay.ldxp.cn/item/new-1",
      "https://pay.ldxp.cn/item/new-2",
    ]);

    await expect(repository.saveCandidateValidation(
      "candidate-1",
      result,
      new Date("2026-07-13T00:00:00.000Z"),
    )).resolves.toEqual({
      saved: true,
      discoveredIds: ["candidate-winner"],
    });
    expect(harness.onConflictDoNothing).toHaveBeenCalledTimes(2);
    expect(harness.onConflictDoNothing).toHaveBeenCalledWith({
      target: discoveryCandidates.urlFingerprint,
    });
    expect(returning).toHaveBeenCalledWith({ id: discoveryCandidates.id });
  });

  it("attempts at most 50 discovered-link inserts", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const harness = createCandidateSaveHarness(returning);
    const repository = createWorkerRepositoryFromDb(harness.db);

    await repository.saveCandidateValidation(
      "candidate-1",
      validationWithPlatformLinks(
      Array.from(
        { length: 60 },
        (_, index) => `https://pay.ldxp.cn/item/${index}`,
      ),
      ),
      new Date("2026-07-13T00:00:00.000Z"),
    );

    expect(harness.discoveryValues).toHaveBeenCalledTimes(50);
    expect(harness.onConflictDoNothing).toHaveBeenCalledTimes(50);
  });

  it("skips discovered links longer than 2048 characters", async () => {
    const harness = createCandidateSaveHarness();
    const repository = createWorkerRepositoryFromDb(harness.db);

    await expect(repository.saveCandidateValidation(
      "candidate-1",
      validationWithPlatformLinks([
        `https://pay.ldxp.cn/item/${"x".repeat(2_048)}`,
      ]),
      new Date("2026-07-13T00:00:00.000Z"),
    )).resolves.toEqual({ saved: true, discoveredIds: [] });

    expect(harness.discoveryValues).not.toHaveBeenCalled();
  });

  it("preserves manual investigation evidence when validation refreshes fields", () => {
    const validation = {
      extraction: {
        title: "K12 refreshed title",
        price: "12.00",
        currency: "CNY",
        availability: "OUT_OF_STOCK",
        stockText: "库存 0",
        stockQuantity: 0,
        buyAction: false,
        pageFingerprint: "new-page-hash",
        confidence: { title: 0.9, price: 0.8, availability: 1 },
      },
    } as ValidatorResponse;

    expect(
      mergeCandidateExtraction(
        {
          focus: "K12",
          note: "商铺公告明确写明 K12 已拉闸",
          sourceUrl: "https://shop.example/source",
          merchantName: "调查商铺",
        },
        validation,
        new Date("2026-07-12T00:00:00.000Z"),
      ),
    ).toMatchObject({
      focus: "K12",
      note: "商铺公告明确写明 K12 已拉闸",
      sourceUrl: "https://shop.example/source",
      merchantName: "调查商铺",
      pageTitle: "K12 refreshed title",
      price: "12.00",
      availability: "OUT_OF_STOCK",
      inventory: 0,
      observedAt: "2026-07-12T00:00:00.000Z",
    });
  });
});

describe("public search persistence", () => {
  it("deduplicates candidates and records a sanitized source run", async () => {
    const candidateReturning = vi.fn()
      .mockResolvedValueOnce([{ id: "candidate-new" }])
      .mockResolvedValueOnce([]);
    const candidateValues = vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: candidateReturning,
      }),
    });
    const eventValues = vi.fn().mockResolvedValue(undefined);
    const observationValues = vi.fn().mockResolvedValue(undefined);
    const sourceOnConflict = vi.fn().mockResolvedValue(undefined);
    const sourceValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: sourceOnConflict,
    });
    const insert = vi.fn((table: unknown) => {
      if (table === discoveryCandidates) return { values: candidateValues };
      if (table === discoveryEvents) return { values: eventValues };
      if (table === candidateObservations) {
        return { values: observationValues };
      }
      if (table === watchSources) return { values: sourceValues };
      throw new Error("unexpected table");
    });
    const selectLimit = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: "candidate-existing",
        extractionResult: {},
      }]);
    const selectWhere = vi.fn().mockReturnValue({ limit: selectLimit });
    const selectFrom = vi.fn().mockReturnValue({ where: selectWhere });
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const tx = {
      insert,
      select: vi.fn().mockReturnValue({ from: selectFrom }),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    };
    const db = {
      insert,
      transaction: vi.fn(async (
        operation: (transaction: typeof tx) => Promise<unknown>,
      ) => operation(tx)),
    } as unknown as Db;
    const repository = createWorkerRepositoryFromDb(db, {
      now: () => new Date("2026-07-15T06:00:00.000Z"),
    });

    await expect(repository.savePublicSearchRun({
      candidates: [
        {
          url: "https://shop.example/item/k12",
          title: "K12 account",
          snippet: "公开商品",
          engine: "priceai",
          focus: "K12",
          sourceUrl: "https://priceai.cc/products/chatgpt-team-business",
          metadata: {
            price: 0.88,
            currency: "CNY",
            inventory: 18,
            merchantName: "公开商铺",
            availability: "IN_STOCK",
            observedAt: "2026-07-15T05:00:00.000Z",
          },
        },
        {
          url: "https://shop.example/item/bug",
          title: "Bug Team account",
          snippet: "公开商品",
          engine: "google",
          focus: "Bug Team",
        },
      ],
      engines: [
        {
          engine: "priceai",
          status: "ACTIVE",
          resultCount: 1,
          errorCategory: null,
        },
        {
          engine: "bing-rss",
          status: "ACTIVE",
          resultCount: 2,
          errorCategory: null,
        },
        {
          engine: "google",
          status: "AUTH_DISABLED",
          resultCount: 0,
          errorCategory: "AUTH_DISABLED",
        },
      ],
    })).resolves.toEqual({ inserted: 1, deduped: 1 });

    expect(candidateValues).toHaveBeenCalledTimes(2);
    expect(candidateValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        productUrl: "https://shop.example/item/k12",
        extractionResult: expect.objectContaining({
          sourceEngine: "priceai",
          sourceUrl: "https://priceai.cc/products/chatgpt-team-business",
          price: 0.88,
          inventory: 18,
          merchantName: "公开商铺",
          availability: "IN_STOCK",
          observedAt: "2026-07-15T05:00:00.000Z",
        }),
      }),
    );
    expect(eventValues).toHaveBeenCalledOnce();
    expect(observationValues).toHaveBeenCalledTimes(2);
    expect(eventValues).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://priceai.cc/products/chatgpt-team-business",
        platform: "priceai",
      }),
    );
    expect(sourceValues).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "src-web-public-search",
        platform: "web",
        status: "ACTIVE",
        lastRunResult: expect.objectContaining({
          discoveredCount: 2,
          insertedCount: 1,
          dedupedCount: 1,
          errorCategory: "AUTH_DISABLED",
        }),
      }),
    );
    expect(sourceOnConflict).toHaveBeenCalledOnce();
  });
});

function createCandidateSaveHarness(
  discoveryReturning = vi.fn().mockResolvedValue([]),
  extractionResult: Record<string, unknown> = {},
) {
  const limit = vi.fn().mockResolvedValue([{ extractionResult }]);
  const selectWhere = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where: selectWhere });
  const select = vi.fn().mockReturnValue({ from });
  const updateReturning = vi.fn().mockResolvedValue([{ id: "candidate-1" }]);
  const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning });
  const set = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set });
  const linkCheckValues = vi.fn().mockResolvedValue(undefined);
  const onConflictDoNothing = vi.fn().mockReturnValue({
    returning: discoveryReturning,
  });
  const discoveryValues = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn((table: unknown) =>
    table === linkChecks
      ? { values: linkCheckValues }
      : { values: discoveryValues });
  const tx = { select, update, insert };
  const db = {
    transaction: vi.fn(async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => operation(tx)),
  } as unknown as Db;
  return { db, discoveryValues, onConflictDoNothing, set };
}

function validationWithPlatformLinks(platformLinks: string[]): ValidatorResponse {
  return {
    ...repositoryValidationResult,
    extraction: { ...repositoryValidationResult.extraction, platformLinks },
  };
}

function expectSqlCondition(
  condition: unknown,
  expected: { sql: unknown; params: unknown[] },
): void {
  const query = (condition as {
    toQuery: (config: unknown) => { sql: string; params: unknown[] };
  }).toQuery({
    casing: {
      getColumnCasing: (column: { name: string }) => column.name,
    },
    escapeName: (name: string) => `"${name}"`,
    escapeParam: (index: number) => `$${index + 1}`,
    escapeString: (value: string) => `'${value.replaceAll("'", "''")}'`,
  });
  expect(query).toEqual(expect.objectContaining(expected));
}
