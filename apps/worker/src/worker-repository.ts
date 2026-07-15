import { createHash, randomUUID } from "node:crypto";
import {
  and,
  alertEvents,
  asc,
  candidateObservations,
  createDb,
  discoveryCandidates,
  discoveryEvents,
  eq,
  inArray,
  linkChecks,
  listingObservations,
  listings,
  lt,
  or,
  watchSources,
  type Db,
  type Transaction,
} from "@compare/db";
import type { WorkerRepository } from "./job-handlers.js";
import {
  ValidatorClientError,
  type ValidatorResponse,
} from "./validator-client.js";
import {
  DEFAULT_PUBLIC_SEARCH_QUERIES,
  type PublicSearchCandidate,
  type PublicSearchResult,
} from "./jobs/revalidate.js";

export function mergeCandidateExtraction(
  existingValue: unknown,
  validation: ValidatorResponse,
  observedAt: Date,
): Record<string, unknown> {
  const existing = isRecord(existingValue) ? existingValue : {};
  const extraction = validation.extraction;
  return {
    ...existing,
    ...(extraction.title ? { pageTitle: extraction.title } : {}),
    ...(extraction.price ? { price: extraction.price } : {}),
    ...(extraction.currency ? { currency: extraction.currency } : {}),
    availability: extraction.availability,
    ...(extraction.stockText ? { stockText: extraction.stockText } : {}),
    ...(extraction.stockQuantity !== null
      ? { inventory: extraction.stockQuantity }
      : {}),
    observedAt: observedAt.toISOString(),
    validation: {
      finalUrl: validation.finalUrl,
      httpStatus: validation.httpStatus,
      redirectChain: validation.redirectChain,
      elapsedMs: validation.elapsedMs,
      buyAction: extraction.buyAction,
      pageFingerprint: extraction.pageFingerprint,
      confidence: extraction.confidence,
    },
  };
}

export const K12_MAX_EFFECTIVE_PRICE_CNY = 1.2;

export function isK12AbovePriceLimit(
  extraction: Record<string, unknown>,
): boolean {
  if (extraction.focus !== "K12") return false;
  const totalPrice = positiveNumber(extraction.totalPrice);
  const price = positiveNumber(extraction.price);
  const effectivePrice = totalPrice ?? price;
  return effectivePrice !== null &&
    effectivePrice > K12_MAX_EFFECTIVE_PRICE_CNY;
}

export interface WorkerRepositoryRuntime extends WorkerRepository {
  savePublicSearchRun: (
    result: PublicSearchResult,
  ) => Promise<{ inserted: number; deduped: number }>;
  close: () => Promise<void>;
}

export interface WorkerRepositoryWithDiscovery extends WorkerRepository {
  savePublicSearchRun: WorkerRepositoryRuntime["savePublicSearchRun"];
}

export const CANDIDATE_VALIDATION_LEASE_MS = 5 * 60 * 1_000;
const MAX_DISCOVERED_PLATFORM_LINKS = 50;
const MAX_DISCOVERED_URL_LENGTH = 2_048;
const MAX_PUBLIC_SEARCH_CANDIDATES = 200;
const PUBLIC_SEARCH_TRANSACTION_BATCH_SIZE = 20;
const PRICE_CHANGE_ALERT_RATIO = 0.1;
const PRICE_ANOMALY_RATIO = 0.5;

interface WorkerRepositoryOptions {
  now?: () => Date;
  candidateLeaseMs?: number;
}

export function createWorkerRepository(
  databaseUrl: string,
  options: WorkerRepositoryOptions = {},
): WorkerRepositoryRuntime {
  const db = createDb(databaseUrl, {
    maxConnections: 4,
    idleTimeoutSeconds: 5,
  });
  return {
    ...createWorkerRepositoryFromDb(db, options),
    async close() {
      await db.$client.end({ timeout: 5 });
    },
  };
}

export function createWorkerRepositoryFromDb(
  db: Db,
  options: WorkerRepositoryOptions = {},
): WorkerRepositoryWithDiscovery {
  const now = options.now ?? (() => new Date());
  const candidateLeaseMs = options.candidateLeaseMs ??
    CANDIDATE_VALIDATION_LEASE_MS;
  const candidateIsClaimable = (referenceTime: Date) =>
    or(
      inArray(discoveryCandidates.status, ["DISCOVERED", "RETRY_WAIT"]),
      and(
        eq(discoveryCandidates.status, "VALIDATING"),
        lt(
          discoveryCandidates.updatedAt,
          new Date(referenceTime.getTime() - candidateLeaseMs),
        ),
      ),
    );

  return {
    async listCandidateIdsForValidation(limit = 100) {
      const rows = await db
        .select({ id: discoveryCandidates.id })
        .from(discoveryCandidates)
        .where(
          candidateIsClaimable(now()),
        )
        .orderBy(asc(discoveryCandidates.updatedAt))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async claimCandidateForValidation(id) {
      const claimedAt = now();
      const [candidate] = await db
        .update(discoveryCandidates)
        .set({ status: "VALIDATING", updatedAt: claimedAt })
        .where(
          and(
            eq(discoveryCandidates.id, id),
            candidateIsClaimable(claimedAt),
          ),
        )
        .returning({
          id: discoveryCandidates.id,
          productUrl: discoveryCandidates.productUrl,
          claimedAt: discoveryCandidates.updatedAt,
        });
      return candidate ?? null;
    },

    async saveCandidateValidation(id, result, claimedAt) {
      const observedAt = new Date();
      return db.transaction(async (tx) => {
        const ownership = candidateLeaseOwnership(id, claimedAt);
        const [candidate] = await tx
          .select({ extractionResult: discoveryCandidates.extractionResult })
          .from(discoveryCandidates)
          .where(ownership)
          .limit(1);
        if (!candidate) return { saved: false, discoveredIds: [] };

        const extractionResult = mergeCandidateExtraction(
          candidate.extractionResult,
          result,
          observedAt,
        );
        const exceedsK12PriceLimit = isK12AbovePriceLimit(extractionResult);
        const [updated] = await tx
          .update(discoveryCandidates)
          .set({
            finalUrl: result.finalUrl,
            status: exceedsK12PriceLimit ? "REJECTED" : "REVIEW_REQUIRED",
            rejectionReason: exceedsK12PriceLimit
              ? "K12_PRICE_ABOVE_LIMIT"
              : null,
            extractionResult,
            updatedAt: observedAt,
          })
          .where(ownership)
          .returning({ id: discoveryCandidates.id });
        if (!updated) return { saved: false, discoveredIds: [] };
        await tx.insert(linkChecks).values({
          id: randomUUID(),
          candidateId: id,
          originalUrl: result.originalUrl,
          httpStatus: result.httpStatus,
          redirectChain: result.redirectChain,
          finalUrl: result.finalUrl,
          pageVerdict: result.extraction.availability,
          elapsedMs: result.elapsedMs,
          checkedAt: observedAt,
        });
        const discoveredIds = await insertDiscoveredPlatformLinks(
          tx,
          result.extraction.platformLinks,
          observedAt,
        );
        return { saved: true, discoveredIds };
      });
    },

    async saveCandidateFailure(id, error, claimedAt) {
      const checkedAt = new Date();
      const failure = describeFailure(error);
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .update(discoveryCandidates)
          .set({ status: "RETRY_WAIT", updatedAt: checkedAt })
          .where(candidateLeaseOwnership(id, claimedAt))
          .returning({ productUrl: discoveryCandidates.productUrl });
        if (!candidate) return false;
        await tx.insert(linkChecks).values({
          id: randomUUID(),
          candidateId: id,
          originalUrl: candidate.productUrl,
          failureCategory: failure.code,
          failureDetail: failure.message,
          checkedAt,
        });
        return true;
      });
    },

    async listListingIdsForRevalidation(limit = 100) {
      const rows = await db
        .select({ id: listings.id })
        .from(listings)
        .where(
          inArray(listings.status, ["ACTIVE", "OUT_OF_STOCK", "RECHECK"]),
        )
        .orderBy(asc(listings.lastVerifiedAt))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async getListingForRevalidation(id) {
      const [listing] = await db
        .select({
          id: listings.id,
          originalUrl: listings.originalUrl,
          status: listings.status,
          consecutiveFailures: listings.consecutiveFailures,
          lastSuccessAt: listings.lastSuccessAt,
        })
        .from(listings)
        .where(eq(listings.id, id))
        .limit(1);
      return listing ?? null;
    },

    async saveListingRevalidation(id, result) {
      const checkedAt = new Date();
      await db.transaction(async (tx) => {
        const [listing] = await tx
          .select({ originalUrl: listings.originalUrl })
          .from(listings)
          .where(eq(listings.id, id))
          .limit(1);
        if (!listing) return;

        if (result.observation) {
          const observation = result.observation;
          await tx
            .update(listings)
            .set({
              finalUrl: observation.finalUrl,
              originalPrice: observation.extraction.price,
              currency: observation.extraction.currency,
              stockEvidence: stockEvidence(observation),
              status: result.status,
              consecutiveFailures: 0,
              lastVerifiedAt: checkedAt,
              lastSuccessAt: checkedAt,
              updatedAt: checkedAt,
            })
            .where(eq(listings.id, id));
          await tx.insert(listingObservations).values({
            id: randomUUID(),
            listingId: id,
            originalPrice: observation.extraction.price,
            currency: observation.extraction.currency,
            stockClaim: stockEvidence(observation),
            pageFingerprint: observation.extraction.pageFingerprint,
            observedAt: checkedAt,
          });
          await tx.insert(linkChecks).values({
            id: randomUUID(),
            listingId: id,
            originalUrl: observation.originalUrl,
            httpStatus: observation.httpStatus,
            redirectChain: observation.redirectChain,
            finalUrl: observation.finalUrl,
            pageVerdict: observation.extraction.availability,
            elapsedMs: observation.elapsedMs,
            checkedAt,
          });
          return;
        }

        const failure = describeFailure(result.failure);
        await tx
          .update(listings)
          .set({
            status: result.status,
            consecutiveFailures: result.consecutiveFailures,
            updatedAt: checkedAt,
          })
          .where(eq(listings.id, id));
        await tx.insert(linkChecks).values({
          id: randomUUID(),
          listingId: id,
          originalUrl: listing.originalUrl,
          failureCategory: result.failureKind ?? failure.code,
          failureDetail: failure.message,
          checkedAt,
        });
      });
    },

    async savePublicSearchRun(result) {
      const observedAt = now();
      const candidates = result.candidates.slice(
        0,
        MAX_PUBLIC_SEARCH_CANDIDATES,
      );
      let inserted = 0;
      for (
        let offset = 0;
        offset < candidates.length;
        offset += PUBLIC_SEARCH_TRANSACTION_BATCH_SIZE
      ) {
        inserted += await db.transaction((tx) =>
          savePublicSearchCandidates(
            tx,
            candidates.slice(
              offset,
              offset + PUBLIC_SEARCH_TRANSACTION_BATCH_SIZE,
            ),
            observedAt,
          )
        );
      }

      const status = publicSearchStatus(result);
      const failedEngines = result.engines.filter(
        (engine) => engine.status !== "ACTIVE",
      );
      await db
          .insert(watchSources)
          .values({
            id: "src-web-public-search",
            platform: "web",
            keywords: [...DEFAULT_PUBLIC_SEARCH_QUERIES],
            excludeKeywords: [],
            publicChannels: [],
            status,
            lastRunAt: observedAt,
            lastRunResult: {
              discoveredCount: result.candidates.length,
              insertedCount: inserted,
              dedupedCount: result.candidates.length - inserted,
              engines: result.engines,
              errorCategory: failedEngines[0]?.errorCategory ?? null,
            },
            createdAt: observedAt,
            updatedAt: observedAt,
          })
          .onConflictDoUpdate({
            target: watchSources.id,
            set: {
              status,
              lastRunAt: observedAt,
              lastRunResult: {
                discoveredCount: result.candidates.length,
                insertedCount: inserted,
                dedupedCount: result.candidates.length - inserted,
                engines: result.engines,
                errorCategory: failedEngines[0]?.errorCategory ?? null,
              },
              updatedAt: observedAt,
            },
          });

      return {
        inserted,
        deduped: result.candidates.length - inserted,
      };
    },
  };
}

async function savePublicSearchCandidates(
  tx: Transaction,
  candidates: PublicSearchCandidate[],
  observedAt: Date,
): Promise<number> {
  let inserted = 0;
  for (const candidate of candidates) {
    const canonicalUrl = canonicalizeUrl(candidate.url);
    if (canonicalUrl.length > MAX_DISCOVERED_URL_LENGTH) continue;
    const id = randomUUID();
    const eventId = randomUUID();
    const fingerprint = fingerprintUrl(canonicalUrl);
    const [previous] = await tx
      .select({
        id: discoveryCandidates.id,
        extractionResult: discoveryCandidates.extractionResult,
      })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.urlFingerprint, fingerprint))
      .limit(1);
    const nextExtraction = publicSearchExtraction(candidate, observedAt);
    const previousExtraction = isRecord(previous?.extractionResult)
      ? previous.extractionResult
      : {};
    const change = classifyCandidateChange(previousExtraction, nextExtraction);
    const [saved] = await tx
      .insert(discoveryCandidates)
      .values({
        id,
        productUrl: canonicalUrl,
        canonicalUrl,
        urlFingerprint: fingerprint,
        sourceType: "manual",
        discoveryEventId: eventId,
        status: "DISCOVERED",
        extractionResult: nextExtraction,
        createdAt: observedAt,
        updatedAt: observedAt,
      })
      .onConflictDoNothing({ target: discoveryCandidates.urlFingerprint })
      .returning({ id: discoveryCandidates.id });
    const candidateId = saved?.id ?? previous?.id;
    if (!candidateId) continue;
    if (saved) {
      await tx.insert(discoveryEvents).values({
        id: eventId,
        sourceUrl: candidate.sourceUrl ?? canonicalUrl,
        platform: candidate.engine,
        summary: [candidate.title, candidate.snippet]
          .filter(Boolean)
          .join(" - ")
          .slice(0, 2_000),
        discoveredAt: observedAt,
      });
      inserted++;
    } else if (!change.anomalous && previous) {
      await tx
        .update(discoveryCandidates)
        .set({
          extractionResult: {
            ...previousExtraction,
            ...nextExtraction,
          },
          updatedAt: observedAt,
        })
        .where(eq(discoveryCandidates.id, previous.id));
    }

    await tx.insert(candidateObservations).values({
      id: randomUUID(),
      candidateId,
      ...(candidate.metadata?.price === undefined
        ? {}
        : { price: String(candidate.metadata.price) }),
      ...(candidate.metadata?.price === undefined
        ? {}
        : { totalPrice: String(candidate.metadata.price) }),
      currency: candidate.metadata?.currency ?? null,
      inventory: candidate.metadata?.inventory ?? null,
      availability: candidate.metadata?.availability ?? "UNKNOWN",
      sourceEngine: candidate.engine,
      anomalous: change.anomalous,
      observedAt,
    });
    for (const alert of buildCandidateAlerts(
      candidateId,
      candidate.title,
      change,
      observedAt,
    )) {
      await tx.insert(alertEvents).values(alert).onConflictDoNothing({
        target: alertEvents.dedupeKey,
      });
    }
  }
  return inserted;
}

function positiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function publicSearchStatus(
  result: PublicSearchResult,
): "ACTIVE" | "AUTH_DISABLED" | "RATE_LIMITED" | "ERROR" {
  if (result.engines.some((engine) => engine.status === "ACTIVE")) {
    return "ACTIVE";
  }
  if (result.engines.some((engine) => engine.status === "RATE_LIMITED")) {
    return "RATE_LIMITED";
  }
  if (result.engines.some((engine) => engine.status === "AUTH_DISABLED")) {
    return "AUTH_DISABLED";
  }
  return "ERROR";
}

async function insertDiscoveredPlatformLinks(
  tx: Transaction,
  links: string[],
  now: Date,
): Promise<string[]> {
  const insertedIds: string[] = [];
  const seen = new Set<string>();
  for (const url of links.slice(0, MAX_DISCOVERED_PLATFORM_LINKS)) {
    if (url.length > MAX_DISCOVERED_URL_LENGTH) continue;
    const canonicalUrl = canonicalizeUrl(url);
    if (
      canonicalUrl.length > MAX_DISCOVERED_URL_LENGTH ||
      seen.has(canonicalUrl)
    ) {
      continue;
    }
    seen.add(canonicalUrl);
    const urlFingerprint = fingerprintUrl(canonicalUrl);
    const id = randomUUID();
    const [inserted] = await tx
      .insert(discoveryCandidates)
      .values({
        id,
        productUrl: canonicalUrl,
        canonicalUrl,
        urlFingerprint,
        sourceType: "manual",
        status: "DISCOVERED",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: discoveryCandidates.urlFingerprint })
      .returning({ id: discoveryCandidates.id });
    if (inserted) insertedIds.push(inserted.id);
  }
  return insertedIds;
}

function candidateLeaseOwnership(id: string, claimedAt: Date) {
  return and(
    eq(discoveryCandidates.id, id),
    eq(discoveryCandidates.status, "VALIDATING"),
    eq(discoveryCandidates.updatedAt, claimedAt),
  );
}

function stockEvidence(result: ValidatorResponse) {
  return {
    availability: result.extraction.availability,
    stockText: result.extraction.stockText,
    stockQuantity: result.extraction.stockQuantity,
    buyAction: result.extraction.buyAction,
    confidence: result.extraction.confidence.availability,
  };
}

function describeFailure(error: unknown): { code: string; message: string } {
  const code = error instanceof ValidatorClientError ? error.code : "UNKNOWN";
  const message = error instanceof Error ? error.message : String(error);
  return { code, message: redactQueryStrings(message).slice(0, 2_000) };
}

interface CandidateChange {
  previousPrice: number | null;
  currentPrice: number | null;
  previousAvailability: string | null;
  currentAvailability: string | null;
  anomalous: boolean;
  priceDropped: boolean;
  restocked: boolean;
}

function publicSearchExtraction(
  candidate: PublicSearchCandidate,
  observedAt: Date,
): Record<string, unknown> {
  return {
    pageTitle: candidate.title || undefined,
    focus: candidate.focus,
    sourceEngine: candidate.engine,
    ...(candidate.sourceUrl ? { sourceUrl: candidate.sourceUrl } : {}),
    ...candidate.metadata,
    searchSnippet: candidate.snippet || undefined,
    note:
      `Public listing discovered through ${candidate.engine}; ` +
      "price and stock require direct page validation.",
    observedAt: candidate.metadata?.observedAt ?? observedAt.toISOString(),
  };
}

export function classifyCandidateChange(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): CandidateChange {
  const previousPrice = positiveNumber(previous.totalPrice) ??
    positiveNumber(previous.price);
  const currentPrice = positiveNumber(current.totalPrice) ??
    positiveNumber(current.price);
  const previousAvailability = stringValue(previous.availability);
  const currentAvailability = stringValue(current.availability);
  const ratio = previousPrice === null || currentPrice === null
    ? 0
    : Math.abs(currentPrice - previousPrice) / previousPrice;
  const anomalous = ratio > PRICE_ANOMALY_RATIO;
  return {
    previousPrice,
    currentPrice,
    previousAvailability,
    currentAvailability,
    anomalous,
    priceDropped:
      !anomalous &&
      previousPrice !== null &&
      currentPrice !== null &&
      currentPrice < previousPrice &&
      (previousPrice - currentPrice) / previousPrice >=
        PRICE_CHANGE_ALERT_RATIO,
    restocked:
      previousAvailability === "OUT_OF_STOCK" &&
      currentAvailability === "IN_STOCK",
  };
}

function buildCandidateAlerts(
  candidateId: string,
  title: string,
  change: CandidateChange,
  observedAt: Date,
) {
  const alerts: Array<typeof alertEvents.$inferInsert> = [];
  if (change.anomalous) {
    alerts.push({
      id: randomUUID(),
      candidateId,
      kind: "PRICE_ANOMALY",
      severity: "warning",
      title: `价格异常：${title || "未命名商品"}`,
      detail: {
        previousPrice: change.previousPrice,
        currentPrice: change.currentPrice,
      },
      dedupeKey:
        `${candidateId}:PRICE_ANOMALY:${change.currentPrice ?? "unknown"}`,
      createdAt: observedAt,
    });
  } else if (change.priceDropped) {
    alerts.push({
      id: randomUUID(),
      candidateId,
      kind: "PRICE_DROP",
      severity: "info",
      title: `价格下降：${title || "未命名商品"}`,
      detail: {
        previousPrice: change.previousPrice,
        currentPrice: change.currentPrice,
      },
      dedupeKey: `${candidateId}:PRICE_DROP:${change.currentPrice}`,
      createdAt: observedAt,
    });
  }
  if (change.restocked) {
    alerts.push({
      id: randomUUID(),
      candidateId,
      kind: "RESTOCKED",
      severity: "info",
      title: `恢复库存：${title || "未命名商品"}`,
      detail: { availability: change.currentAvailability },
      dedupeKey: `${candidateId}:RESTOCKED:${observedAt.toISOString()}`,
      createdAt: observedAt,
    });
  }
  return alerts;
}

function redactQueryStrings(message: string): string {
  return message.replace(/https?:\/\/[^\s]+/g, (rawUrl) => {
    try {
      const url = new URL(rawUrl);
      if (url.search) url.search = "?redacted";
      return url.toString();
    } catch {
      return "[redacted-url]";
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function canonicalizeUrl(productUrl: string): string {
  const url = new URL(productUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("UNSUPPORTED_URL_PROTOCOL");
  }
  url.hash = "";
  return url.toString();
}

function fingerprintUrl(canonicalUrl: string): string {
  return createHash("sha256").update(canonicalUrl).digest("hex");
}
