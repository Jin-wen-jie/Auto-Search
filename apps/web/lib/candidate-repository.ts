import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  auditEvents,
  discoveryCandidates,
  discoveryEvents,
  productSpecs,
} from "@compare/db";
import {
  canNormalizeCandidateStatus,
  canonicalizeCandidateUrl,
  fingerprintCandidateUrl,
  toCandidateView,
  type CandidateView,
} from "./candidate-service";
import { getDatabase } from "./database";

export interface CandidatePage {
  items: CandidateView[];
  page: number;
  pageSize: number;
  total: number;
}

export async function listCandidates(options: {
  page?: number;
  pageSize?: number;
} = {}): Promise<CandidatePage> {
  const db = getDatabase();
  const requestedPage = options.page ?? 1;
  const requestedPageSize = options.pageSize ?? 50;
  const page = Number.isFinite(requestedPage)
    ? Math.max(1, Math.floor(requestedPage))
    : 1;
  const pageSize = Number.isFinite(requestedPageSize)
    ? Math.min(100, Math.max(1, Math.floor(requestedPageSize)))
    : 50;
  const focus = sql<string | null>`${discoveryCandidates.extractionResult} ->> 'focus'`;
  const rows = await db
    .select({
      id: discoveryCandidates.id,
      productUrl: discoveryCandidates.productUrl,
      sourceType: discoveryCandidates.sourceType,
      status: discoveryCandidates.status,
      extractionResult: discoveryCandidates.extractionResult,
      eventSourceUrl: discoveryEvents.sourceUrl,
      comparisonKey: discoveryCandidates.comparisonKey,
      specId: discoveryCandidates.specId,
      createdAt: discoveryCandidates.createdAt,
      total: sql<number>`count(*) over()::int`,
    })
    .from(discoveryCandidates)
    .leftJoin(
      discoveryEvents,
      eq(discoveryCandidates.discoveryEventId, discoveryEvents.id),
    )
    .where(
      and(
        inArray(discoveryCandidates.status, [
          "DISCOVERED",
          "REVIEW_REQUIRED",
        ]),
        sql`(${focus} is null or ${focus} in ('K12', 'Bug Team'))`,
      ),
    )
    .orderBy(
      sql`case when ${focus} in ('K12', 'Bug Team') then 0 else 1 end`,
      desc(discoveryCandidates.createdAt),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  if (rows.length === 0 && page > 1) {
    return listCandidates({ page: 1, pageSize });
  }

  return {
    items: rows.map(toCandidateView),
    page,
    pageSize,
    total: Number(rows[0]?.total ?? 0),
  };
}

export async function createManualCandidate(productUrl: string): Promise<{
  candidate: CandidateView;
  created: boolean;
}> {
  const db = getDatabase();
  const canonicalUrl = canonicalizeCandidateUrl(productUrl);
  const urlFingerprint = fingerprintCandidateUrl(canonicalUrl);
  const [inserted] = await db
    .insert(discoveryCandidates)
    .values({
      id: randomUUID(),
      productUrl: canonicalUrl,
      canonicalUrl,
      urlFingerprint,
      sourceType: "manual",
      status: "DISCOVERED",
    })
    .onConflictDoNothing({ target: discoveryCandidates.urlFingerprint })
    .returning();

  const row =
    inserted ??
    (
      await db
        .select()
        .from(discoveryCandidates)
        .where(eq(discoveryCandidates.urlFingerprint, urlFingerprint))
        .limit(1)
    )[0];
  if (!row) throw new Error("CANDIDATE_CREATE_FAILED");

  return {
    created: Boolean(inserted),
    candidate: toCandidateView({
      id: row.id,
      productUrl: row.productUrl,
      sourceType: row.sourceType,
      status: row.status,
      extractionResult: row.extractionResult,
      eventSourceUrl: null,
      comparisonKey: row.comparisonKey,
      specId: row.specId,
      createdAt: row.createdAt,
    }),
  };
}

export type ReviewCandidateResult =
  | { ok: false; reason: "NOT_FOUND" }
  | {
      ok: true;
      id: string;
      status: "APPROVED" | "REJECTED";
      reason: string | null;
      reviewedAt: string;
    };

export async function reviewCandidate(
  id: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<ReviewCandidateResult> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const reviewedAt = new Date();
    const status = action === "approve" ? "APPROVED" : "REJECTED";
    const [candidate] = await tx
      .update(discoveryCandidates)
      .set({
        status,
        rejectionReason: action === "reject" ? reason ?? null : null,
        updatedAt: reviewedAt,
      })
      .where(
        and(
          eq(discoveryCandidates.id, id),
          inArray(discoveryCandidates.status, [
            "DISCOVERED",
            "REVIEW_REQUIRED",
          ]),
        ),
      )
      .returning({ id: discoveryCandidates.id });
    if (!candidate) return { ok: false, reason: "NOT_FOUND" };

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      action: `candidate.${action}`,
      candidateId: id,
      detail: { reason: reason ?? null },
      createdAt: reviewedAt,
    });

    return {
      ok: true,
      id,
      status,
      reason: reason ?? null,
      reviewedAt: reviewedAt.toISOString(),
    };
  });
}

export interface SpecInfo {
  id: string;
  provider: string;
  productLine: string;
  plan: string;
  delivery: string;
  accessMode: string;
  ownership: string;
  region: string;
  qualification: string;
  validity: string;
  commitment: string;
  quota: string;
  comparisonKey: string;
}

export type NormalizeCandidateResult =
  | {
      ok: false;
      reason: "NOT_FOUND" | "SPEC_NOT_FOUND" | "INVALID_STATUS";
    }
  | {
      ok: true;
      id: string;
      specId: string;
      comparisonKey: string;
      normalizedAt: string;
    };

/**
 * 规格归一化：为候选关联一个商品规格。
 * 在事务中设置 comparisonKey 和 specId，并写入审计事件。
 */
export async function normalizeCandidate(
  id: string,
  specId: string,
): Promise<NormalizeCandidateResult> {
  const db = getDatabase();
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        id: discoveryCandidates.id,
        status: discoveryCandidates.status,
      })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.id, id))
      .limit(1);
    if (!candidate) return { ok: false, reason: "NOT_FOUND" };
    if (!canNormalizeCandidateStatus(candidate.status)) {
      return { ok: false, reason: "INVALID_STATUS" };
    }

    const [spec] = await tx
      .select({ comparisonKey: productSpecs.comparisonKey })
      .from(productSpecs)
      .where(eq(productSpecs.id, specId))
      .limit(1);
    if (!spec) return { ok: false, reason: "SPEC_NOT_FOUND" };

    const normalizedAt = new Date();
    const [updated] = await tx
      .update(discoveryCandidates)
      .set({
        comparisonKey: spec.comparisonKey,
        specId,
        updatedAt: normalizedAt,
      })
      .where(
        and(
          eq(discoveryCandidates.id, id),
          inArray(discoveryCandidates.status, [
            "DISCOVERED",
            "REVIEW_REQUIRED",
          ]),
        ),
      )
      .returning({ id: discoveryCandidates.id });
    if (!updated) return { ok: false, reason: "INVALID_STATUS" };

    await tx.insert(auditEvents).values({
      id: randomUUID(),
      action: "candidate.normalize",
      candidateId: id,
      specId,
      detail: { comparisonKey: spec.comparisonKey },
      createdAt: normalizedAt,
    });

    return {
      ok: true,
      id,
      specId,
      comparisonKey: spec.comparisonKey,
      normalizedAt: normalizedAt.toISOString(),
    };
  });
}

