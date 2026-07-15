import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  discoveryCandidates,
  discoveryEvents,
  listings,
  merchants,
  productSpecs,
  watchSources,
} from "@compare/db";
import {
  toApprovedCandidateRankingView,
  type RankingView,
} from "./admin-read-model";
import { getDatabase } from "./database";

export async function listRankingViews(limit = 200): Promise<RankingView[]> {
  const db = getDatabase();
  const boundedLimit = Number.isFinite(limit)
    ? Math.min(500, Math.max(1, Math.floor(limit)))
    : 200;
  const rows = await db
    .select({
      id: discoveryCandidates.id,
      productUrl: discoveryCandidates.productUrl,
      extractionResult: discoveryCandidates.extractionResult,
      eventSourceUrl: discoveryEvents.sourceUrl,
      createdAt: discoveryCandidates.createdAt,
    })
    .from(discoveryCandidates)
    .leftJoin(
      discoveryEvents,
      eq(discoveryCandidates.discoveryEventId, discoveryEvents.id),
    )
    .where(eq(discoveryCandidates.status, "APPROVED"))
    .orderBy(desc(discoveryCandidates.updatedAt))
    .limit(boundedLimit);

  return rows
    .map(toApprovedCandidateRankingView)
    .sort((left, right) => moneyValue(left.unitCny) - moneyValue(right.unitCny));
}

const ldxpGoodsSchema = z.object({
  code: z.literal(1),
  data: z.object({
    goods_key: z.string().min(1),
    status: z.number(),
    name: z.string().min(1),
    price: z.number().nonnegative(),
    user: z.object({
      nickname: z.string().min(1),
      token: z.string().min(1),
      link: z.string().url(),
    }),
  }),
});

const ldxpChannelsSchema = z.object({
  code: z.literal(1),
  data: z.array(z.object({ id: z.number().int().positive() })),
});

const ldxpPriceSchema = z.object({
  code: z.literal(1),
  data: z.object({
    original_amount: z.number().nonnegative(),
    total_amount: z.number().nonnegative(),
    fee: z.number().nonnegative(),
  }),
});

export interface LdxpListingSnapshot {
  price: number;
  totalPrice: number;
  mandatoryFee: number;
  pageTitle: string;
  merchantName: string;
  merchantUrl: string;
  availability: "IN_STOCK" | "OUT_OF_STOCK";
}

export async function fetchLdxpListingSnapshot(
  productUrl: string,
  request: typeof fetch = fetch,
): Promise<LdxpListingSnapshot> {
  const parsedUrl = new URL(productUrl);
  const match = parsedUrl.pathname.match(/^\/item\/([A-Za-z0-9]+)\/?$/);
  if (parsedUrl.origin !== "https://pay.ldxp.cn" || !match?.[1]) {
    throw new Error("UNSUPPORTED_LDXP_PRODUCT_URL");
  }

  const goodsKey = match[1];
  const goods = ldxpGoodsSchema.parse(
    await postLdxp(request, "/shopApi/Shop/goodsInfo", {
      goods_key: goodsKey,
      trade_no: null,
    }),
  ).data;
  if (goods.goods_key !== goodsKey) throw new Error("LDXP_PRODUCT_MISMATCH");

  const channels = ldxpChannelsSchema.parse(
    await postLdxp(request, "/shopApi/Shop/getUserChannel", {
      token: goods.user.token,
    }),
  ).data;
  const channelId = channels[0]?.id ?? 0;
  const checkout = ldxpPriceSchema.parse(
    await postLdxp(request, "/shopApi/Shop/getGoodsPrice", {
      goods_key: goodsKey,
      quantity: 1,
      coupon_code: "",
      channel_id: channelId,
    }),
  ).data;

  return {
    price: goods.price,
    totalPrice: checkout.total_amount,
    mandatoryFee:
      Math.max(
        0,
        Math.round(
          (checkout.total_amount - checkout.original_amount) * 100,
        ) / 100,
      ),
    pageTitle: goods.name,
    merchantName: goods.user.nickname,
    merchantUrl: goods.user.link,
    availability: goods.status === 1 ? "IN_STOCK" : "OUT_OF_STOCK",
  };
}

export async function refreshApprovedCandidatePrices(): Promise<{
  attempted: number;
  updated: number;
  failures: string[];
}> {
  const db = getDatabase();
  const candidates = await db
    .select({
      id: discoveryCandidates.id,
      productUrl: discoveryCandidates.productUrl,
      extractionResult: discoveryCandidates.extractionResult,
    })
    .from(discoveryCandidates)
    .where(eq(discoveryCandidates.status, "APPROVED"))
    .orderBy(desc(discoveryCandidates.updatedAt))
    .limit(50);

  const results = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const snapshot = await fetchLdxpListingSnapshot(candidate.productUrl);
      const observedAt = new Date();
      const existing = isRecord(candidate.extractionResult)
        ? candidate.extractionResult
        : {};
      const [updated] = await db
        .update(discoveryCandidates)
        .set({
          extractionResult: {
            ...existing,
            ...snapshot,
            observedAt: observedAt.toISOString(),
          },
          updatedAt: observedAt,
        })
        .where(
          and(
            eq(discoveryCandidates.id, candidate.id),
            eq(discoveryCandidates.status, "APPROVED"),
          ),
        )
        .returning({ id: discoveryCandidates.id });
      return Boolean(updated);
    }),
  );

  return {
    attempted: candidates.length,
    updated: results.filter(
      (result) => result.status === "fulfilled" && result.value,
    ).length,
    failures: [
      ...new Set(
        results.flatMap((result) =>
          result.status === "rejected"
            ? [failureCategory(result.reason)]
            : result.value
              ? []
              : ["NOT_UPDATED"]
        ),
      ),
    ],
  };
}

async function postLdxp(
  request: typeof fetch,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await request(`https://pay.ldxp.cn${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`LDXP_HTTP_${response.status}`);
  return response.json();
}

export async function getDashboardCounts() {
  const db = getDatabase();
  const [counts] = await db
    .select({
      candidates: sql<number>`(select count(*)::int from ${discoveryCandidates})`,
      merchants: sql<number>`(select count(distinct ${discoveryCandidates.extractionResult} ->> 'merchantName')::int from ${discoveryCandidates} where ${discoveryCandidates.status} = 'APPROVED')`,
      listings: sql<number>`(select count(*)::int from ${discoveryCandidates} where ${discoveryCandidates.status} = 'APPROVED')`,
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

function moneyValue(value: string): number {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function failureCategory(error: unknown): string {
  if (error instanceof z.ZodError) return "INVALID_RESPONSE";
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return "TIMEOUT";
    if (/^[A-Z0-9_]+$/.test(error.message)) return error.message;
  }
  return "REFRESH_FAILED";
}
