import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}));

vi.mock("./database", () => ({
  getDatabase: mocks.getDatabase,
}));

import { toRankingView } from "./admin-read-model.js";
import { getDashboardCounts } from "./admin-read-repository.js";

describe("admin read model", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps only persisted listing facts into a ranking row", () => {
    expect(
      toRankingView({
        id: "listing-1",
        provider: "Bug Team",
        productLine: "ChatGPT",
        plan: "Team",
        delivery: "INVITE_SEAT",
        merchantName: "公开商铺",
        merchantUrl: "https://shop.example/",
        originalUrl: "https://shop.example/item/1",
        sourceUrl: "https://x.com/example/status/1",
        originalPrice: "120.00",
        currency: "CNY",
        convertedPriceCny: "120.00",
        bundleQty: 2,
        minBundleCount: 1,
        stockEvidence: {
          availability: "IN_STOCK",
          stockQuantity: 8,
          confidence: 0.9,
        },
        lastVerifiedAt: new Date("2026-07-12T00:00:00.000Z"),
      }),
    ).toEqual({
      id: "listing-1",
      spec: "Bug Team | ChatGPT | Team | INVITE_SEAT",
      merchant: "公开商铺",
      price: "CNY 120.00",
      totalCny: "¥120.00",
      unitCny: "¥60.00/份",
      supplyEvidence: "IN_STOCK · 库存 8",
      confidence: 90,
      lastVerified: "2026-07-12T00:00:00.000Z",
      productUrl: "https://shop.example/item/1",
      sourceUrl: "https://x.com/example/status/1",
      merchantUrl: "https://shop.example/",
    });
  });

  it("counts dashboard records in PostgreSQL without loading every row", async () => {
    const from = vi.fn().mockResolvedValue([
      { candidates: 80, merchants: 12, listings: 34 },
    ]);
    const select = vi.fn().mockReturnValue({ from });
    mocks.getDatabase.mockReturnValue({ select });

    await expect(getDashboardCounts()).resolves.toEqual({
      candidates: 80,
      merchants: 12,
      listings: 34,
    });
    expect(select).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledTimes(1);
  });
});
