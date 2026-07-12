import { describe, expect, it } from "vitest";
import { buildComparisonKey, rankPrices, scoreSupply } from "./index.js";

describe("domain rankings", () => {
  it("keeps shared and exclusive products in separate groups", () => {
    const base = {
      provider: "K12",
      productLine: "Copilot",
      plan: "Education",
      delivery: "ACCOUNT",
      ownership: "TRANSFERRED",
      region: "NONE",
      qualification: "K12",
      validity: "12m",
      commitment: "12m",
      quota: "NOT_APPLICABLE",
    } as const;
    expect(
      buildComparisonKey({ ...base, accessMode: "EXCLUSIVE" }),
    ).not.toBe(
      buildComparisonKey({ ...base, accessMode: "SHARED" }),
    );
  });

  it("calculates the real spend for a target quantity", () => {
    const [row] = rankPrices(
      [
        {
          id: "a",
          packagePriceCny: "17.00",
          bundleQty: 10,
          minBundleCount: 1,
        },
      ],
      15,
    );
    expect(row).toMatchObject({
      requiredBundles: 2,
      actualQty: 20,
      totalCny: "34.00",
      unitCny: "1.70",
    });
  });

  it("always ranks explicit inventory above inferred availability", () => {
    const explicit = scoreSupply({
      kind: "EXPLICIT",
      quantity: 1,
      referenceStock: 10,
      ageHours: 2,
      consistentChecks: 1,
      successfulChecks30d: 1,
      totalChecks30d: 1,
      siblingListings: 1,
    });
    const inferred = scoreSupply({
      kind: "TEXT_IN_STOCK",
      ageHours: 0,
      consistentChecks: 3,
      successfulChecks30d: 30,
      totalChecks30d: 30,
      siblingListings: 20,
    });
    expect(explicit.score).toBeGreaterThan(inferred.score);
    expect(inferred.confidence).toBeLessThanOrEqual(69);
  });
});
