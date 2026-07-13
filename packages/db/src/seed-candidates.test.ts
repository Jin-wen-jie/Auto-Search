import { describe, expect, it, vi } from "vitest";
import type { Db } from "./client.js";
import {
  type CandidateSeed,
  INITIAL_CANDIDATES,
  seedCandidates,
} from "./seed-candidates.js";

describe("seedCandidates", () => {
  it("keeps public PriceAI research in review with its source evidence", () => {
    const researchCandidates = INITIAL_CANDIDATES.filter(
      (candidate) => candidate.extractionResult?.sourceUrl ===
        "https://priceai.cc/products/chatgpt-team-business",
    );

    expect(researchCandidates.length).toBeGreaterThan(0);
    expect(researchCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "REVIEW_REQUIRED",
          extractionResult: expect.objectContaining({
            focus: "K12",
            note: expect.stringContaining("no fraud conclusion recorded"),
          }),
        }),
        expect.objectContaining({
          status: "REVIEW_REQUIRED",
          extractionResult: expect.objectContaining({
            focus: "Bug Team",
            note: expect.stringContaining("no fraud conclusion recorded"),
          }),
        }),
      ]),
    );
    expect(
      researchCandidates.every(
        (candidate) =>
          candidate.status === "REVIEW_REQUIRED" &&
          candidate.extractionResult !== undefined,
      ),
    ).toBe(true);
  });

  it("persists review evidence once for duplicate canonical input URLs", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          inserted.push(value);
          return Promise.resolve();
        }),
      })),
    } as unknown as Db;
    const extractionResult = {
      sourceUrl: "https://priceai.cc/products/chatgpt-team-business",
      focus: "K12",
      note: "Public research only; no fraud conclusion recorded.",
    };
    const candidates: CandidateSeed[] = [
      {
        productUrl: "https://pay.ldxp.cn/item/example#first",
        sourceType: "manual",
        status: "REVIEW_REQUIRED",
        extractionResult,
      },
      {
        productUrl: "https://pay.ldxp.cn/item/example#second",
        sourceType: "manual",
        status: "REVIEW_REQUIRED",
        extractionResult,
      },
    ];
    await seedCandidates(db, candidates);

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      productUrl: "https://pay.ldxp.cn/item/example",
      canonicalUrl: "https://pay.ldxp.cn/item/example",
      sourceType: "manual",
      status: "REVIEW_REQUIRED",
      extractionResult,
    });
  });
});
