import {
  createDb,
  discoveryCandidates,
  type Db,
} from "@compare/db";
import { describe, expect, it, vi } from "vitest";
import {
  createWorkerRepository,
  createWorkerRepositoryFromDb,
  mergeCandidateExtraction,
} from "./worker-repository.js";
import type { ValidatorResponse } from "./validator-client.js";

vi.mock("@compare/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@compare/db")>();
  return { ...actual, createDb: vi.fn() };
});

describe("worker repository mappings", () => {
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
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    const select = vi.fn().mockReturnValue({ from });
    const returning = vi.fn()
      .mockResolvedValueOnce([{ id: "candidate-winner" }])
      .mockResolvedValueOnce([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const db = {
      select,
      insert: vi.fn().mockReturnValue({ values }),
    } as unknown as Db;
    const repository = createWorkerRepositoryFromDb(db);

    const insertedIds = await repository.saveDiscoveredPlatformLinks([
      "https://shop.example/item/new-1",
      "https://shop.example/item/new-1",
    ]);

    expect(insertedIds).toEqual(["candidate-winner"]);
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
    expect(onConflictDoNothing).toHaveBeenCalledWith({
      target: discoveryCandidates.urlFingerprint,
    });
    expect(returning).toHaveBeenCalledWith({ id: discoveryCandidates.id });
    expect(select).not.toHaveBeenCalled();
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
