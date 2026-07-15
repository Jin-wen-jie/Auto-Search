import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
}));

vi.mock("./database", () => ({
  getDatabase: mocks.getDatabase,
}));

import {
  toApprovedCandidateRankingView,
  toRankingView,
} from "./admin-read-model.js";
import {
  fetchLdxpListingSnapshot,
  getDashboardCounts,
} from "./admin-read-repository.js";

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

  it("maps an approved candidate directly into the dashboard", () => {
    expect(
      toApprovedCandidateRankingView({
        id: "candidate-1",
        productUrl: "https://shop.example/item/1",
        extractionResult: {
          price: 0.85,
          merchantName: "公开商铺",
          focus: "K12",
          availability: "IN_STOCK",
          inventory: 12,
          observedAt: "2026-07-14T19:25:00.000Z",
        },
        eventSourceUrl: "https://source.example/post/1",
        createdAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
    ).toMatchObject({
      id: "candidate-1",
      spec: "K12",
      merchant: "公开商铺",
      price: "CNY 0.85",
      totalCny: "¥0.85",
      unitCny: "¥0.85/件",
      supplyEvidence: "IN_STOCK · 库存 12",
      productUrl: "https://shop.example/item/1",
      sourceUrl: "https://source.example/post/1",
      merchantUrl: "https://shop.example/",
      lastVerified: "2026-07-14T19:25:00.000Z",
    });
  });

  it("uses the mandatory checkout total as the effective unit price", () => {
    expect(
      toApprovedCandidateRankingView({
        id: "candidate-1",
        productUrl: "https://pay.ldxp.cn/item/item1",
        extractionResult: {
          price: 1.4,
          totalPrice: 1.44,
          merchantName: "公开商铺",
          focus: "K12",
          observedAt: "2026-07-15T06:00:00.000Z",
        },
        eventSourceUrl: null,
        createdAt: new Date("2026-07-14T18:00:00.000Z"),
      }),
    ).toMatchObject({
      price: "CNY 1.40",
      totalCny: "¥1.44",
      unitCny: "¥1.44/件",
    });
  });

  it("reads the current listing and mandatory fee from the public LDXP APIs", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        code: 1,
        data: {
          goods_key: "f1vz1u",
          status: 1,
          name: "K12 商品",
          price: 1.4,
          user: {
            nickname: "奥特曼",
            token: "SHOP1",
            link: "https://pay.ldxp.cn/shop/SHOP1",
          },
        },
      }))
      .mockResolvedValueOnce(Response.json({
        code: 1,
        data: [{ id: 1 }],
      }))
      .mockResolvedValueOnce(Response.json({
        code: 1,
        data: {
          original_amount: 1.4,
          total_amount: 1.44,
          fee: 0.04,
        },
      }));

    await expect(
      fetchLdxpListingSnapshot(
        "https://pay.ldxp.cn/item/f1vz1u",
        request,
      ),
    ).resolves.toEqual({
      price: 1.4,
      totalPrice: 1.44,
      mandatoryFee: 0.04,
      pageTitle: "K12 商品",
      merchantName: "奥特曼",
      merchantUrl: "https://pay.ldxp.cn/shop/SHOP1",
      availability: "IN_STOCK",
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "https://www.ldxp.cn/shopApi/Shop/getGoodsPrice",
      expect.objectContaining({
        body: JSON.stringify({
          goods_key: "f1vz1u",
          quantity: 1,
          coupon_code: "",
          channel_id: 1,
        }),
      }),
    );
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
