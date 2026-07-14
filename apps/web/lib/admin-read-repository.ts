import { and, eq, gte, sql } from "drizzle-orm";
import {
  discoveryCandidates,
  discoveryEvents,
  listings,
  merchants,
  productSpecs,
  watchSources,
} from "@compare/db";
import { toRankingView, type RankingView } from "./admin-read-model";
import { getDatabase } from "./database";

export async function listRankingViews(limit = 200): Promise<RankingView[]> {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.floor(limit)))
    : 200;
  const unitPrice = sql`${listings.convertedPriceCny} / greatest(${listings.bundleQty} * ${listings.minBundleCount}, 1)`;
  const rows = await db
    .select({
      id: listings.id,
      provider: productSpecs.provider,
      productLine: productSpecs.productLine,
      plan: productSpecs.plan,
      delivery: productSpecs.delivery,
      merchantName: merchants.name,
      merchantUrl: merchants.homepageUrl,
      originalUrl: listings.originalUrl,
      sourceUrl: discoveryEvents.sourceUrl,
      originalPrice: listings.originalPrice,
      currency: listings.currency,
      convertedPriceCny: listings.convertedPriceCny,
      bundleQty: listings.bundleQty,
      minBundleCount: listings.minBundleCount,
      stockEvidence: listings.stockEvidence,
      lastVerifiedAt: listings.lastVerifiedAt,
    })
    .from(listings)
    .innerJoin(merchants, eq(listings.merchantId, merchants.id))
    .innerJoin(productSpecs, eq(listings.specId, productSpecs.id))
    .innerJoin(
      discoveryCandidates,
      eq(listings.candidateId, discoveryCandidates.id),
    )
    .leftJoin(
      discoveryEvents,
      eq(discoveryCandidates.discoveryEventId, discoveryEvents.id),
    )
    .where(
      and(
        eq(listings.approved, true),
        eq(listings.status, "ACTIVE"),
        gte(listings.lastVerifiedAt, cutoff),
      ),
    )
    .orderBy(sql`${unitPrice} asc nulls last`)
    .limit(boundedLimit);

  return rows
    .filter(
      (row): row is typeof row & { lastVerifiedAt: Date } =>
        row.lastVerifiedAt !== null,
    )
    .map(toRankingView);
}

export async function getDashboardCounts() {
  const db = getDatabase();
  const [counts] = await db
    .select({
      candidates: sql<number>`(select count(*)::int from ${discoveryCandidates})`,
      merchants: sql<number>`(select count(*)::int from ${merchants})`,
      listings: sql<number>`(select count(*)::int from ${listings})`,
    })
    .from(sql`(select 1) as singleton`);
  return {
    candidates: Number(counts?.candidates ?? 0),
    merchants: Number(counts?.merchants ?? 0),
    listings: Number(counts?.listings ?? 0),
  };
}

export async function listMerchantViews() {
  const db = getDatabase();
  const rows = await db
    .select({
      id: merchants.id,
      name: merchants.name,
      homepageUrl: merchants.homepageUrl,
      platform: merchants.platform,
      activeListings: sql<number>`count(${listings.id}) filter (where ${listings.status} = ${"ACTIVE"})::int`,
      lastVerifiedAt: merchants.lastVerifiedAt,
      status: merchants.status,
    })
    .from(merchants)
    .leftJoin(listings, eq(listings.merchantId, merchants.id))
    .groupBy(merchants.id);
  return rows.map((merchant) => ({
    ...merchant,
    platform: merchant.platform ?? "—",
    activeListings: Number(merchant.activeListings),
    lastVerifiedAt: merchant.lastVerifiedAt?.toISOString() ?? null,
  }));
}

export async function listSpecViews() {
  const db = getDatabase();
  return db
    .select({
      id: productSpecs.id,
      provider: productSpecs.provider,
      productLine: productSpecs.productLine,
      plan: productSpecs.plan,
      delivery: productSpecs.delivery,
      accessMode: productSpecs.accessMode,
      ownership: productSpecs.ownership,
      region: productSpecs.region,
      validity: productSpecs.validity,
      commitment: productSpecs.commitment,
      comparisonKey: productSpecs.comparisonKey,
    })
    .from(productSpecs);
}

export async function listSourceViews() {
  const db = getDatabase();
  const rows = await db.select().from(watchSources);
  return rows.map((source) => {
    const result = isRecord(source.lastRunResult) ? source.lastRunResult : {};
    return {
      id: source.id,
      platform: source.platform,
      status: source.status,
      cursor: source.cursor,
      lastRunAt: source.lastRunAt?.toISOString() ?? null,
      discovered: numberValue(result.discoveredCount) ?? 0,
      errorCategory: stringValue(result.errorCategory),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
