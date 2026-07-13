import { createHash, randomUUID } from "node:crypto";
import {
  asc,
  createDb,
  discoveryCandidates,
  eq,
  inArray,
  linkChecks,
  listingObservations,
  listings,
  type Db,
} from "@compare/db";
import type { WorkerRepository } from "./job-handlers.js";
import {
  ValidatorClientError,
  type ValidatorResponse,
} from "./validator-client.js";

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

export interface WorkerRepositoryRuntime extends WorkerRepository {
  close: () => Promise<void>;
}

export function createWorkerRepository(
  databaseUrl: string,
): WorkerRepositoryRuntime {
  const db = createDb(databaseUrl);
  return {
    ...createWorkerRepositoryFromDb(db),
    async close() {
      await db.$client.end({ timeout: 5 });
    },
  };
}

export function createWorkerRepositoryFromDb(db: Db): WorkerRepository {
  return {
    async listCandidateIdsForValidation(limit = 100) {
      const rows = await db
        .select({ id: discoveryCandidates.id })
        .from(discoveryCandidates)
        .where(
          inArray(discoveryCandidates.status, ["DISCOVERED", "RETRY_WAIT"]),
        )
        .orderBy(asc(discoveryCandidates.updatedAt))
        .limit(limit);
      return rows.map((row) => row.id);
    },

    async getCandidateForValidation(id) {
      const [candidate] = await db
        .select({
          id: discoveryCandidates.id,
          productUrl: discoveryCandidates.productUrl,
        })
        .from(discoveryCandidates)
        .where(eq(discoveryCandidates.id, id))
        .limit(1);
      return candidate ?? null;
    },

    async markCandidateValidating(id) {
      await db
        .update(discoveryCandidates)
        .set({ status: "VALIDATING", updatedAt: new Date() })
        .where(eq(discoveryCandidates.id, id));
    },

    async saveCandidateValidation(id, result) {
      const observedAt = new Date();
      await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ extractionResult: discoveryCandidates.extractionResult })
          .from(discoveryCandidates)
          .where(eq(discoveryCandidates.id, id))
          .limit(1);
        if (!candidate) return;

        await tx
          .update(discoveryCandidates)
          .set({
            finalUrl: result.finalUrl,
            status: "REVIEW_REQUIRED",
            extractionResult: mergeCandidateExtraction(
              candidate.extractionResult,
              result,
              observedAt,
            ),
            updatedAt: observedAt,
          })
          .where(eq(discoveryCandidates.id, id));
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
      });
    },

    async saveCandidateFailure(id, error) {
      const checkedAt = new Date();
      const failure = describeFailure(error);
      await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ productUrl: discoveryCandidates.productUrl })
          .from(discoveryCandidates)
          .where(eq(discoveryCandidates.id, id))
          .limit(1);
        if (!candidate) return;

        await tx
          .update(discoveryCandidates)
          .set({ status: "RETRY_WAIT", updatedAt: checkedAt })
          .where(eq(discoveryCandidates.id, id));
        await tx.insert(linkChecks).values({
          id: randomUUID(),
          candidateId: id,
          originalUrl: candidate.productUrl,
          failureCategory: failure.code,
          failureDetail: failure.message,
          checkedAt,
        });
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

    async saveDiscoveredPlatformLinks(links) {
      const insertedIds: string[] = [];
      const now = new Date();
      for (const url of links) {
        const canonicalUrl = canonicalizeUrl(url);
        const urlFingerprint = fingerprintUrl(canonicalUrl);
        const id = randomUUID();
        const [inserted] = await db
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
  };
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
