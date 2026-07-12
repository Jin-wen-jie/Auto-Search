import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  auditEvents,
  discoveryCandidates,
  discoveryEvents,
} from "@compare/db";
import {
  canonicalizeCandidateUrl,
  fingerprintCandidateUrl,
  toCandidateView,
  type CandidateView,
} from "./candidate-service";
import { getDatabase } from "./database";

export async function listCandidates(): Promise<CandidateView[]> {
  const db = getDatabase();
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
    })
    .from(discoveryCandidates)
    .leftJoin(
      discoveryEvents,
      eq(discoveryCandidates.discoveryEventId, discoveryEvents.id),
    )
    .orderBy(desc(discoveryCandidates.createdAt));

  return rows
    .map(toCandidateView)
    .filter((c) => isK12OrBugTeam(c.focus))
    .sort((left, right) => focusPriority(left.focus) - focusPriority(right.focus));
}

/** Only K12/Bug Team candidates enter the investigation queue. */
function isK12OrBugTeam(focus: string | null): boolean {
  // Candidates that haven't been classified yet are allowed through
  if (focus === null) return true;
  return focus === "K12" || focus === "Bug Team";
}

function focusPriority(focus: string | null): number {
  return focus === "K12" || focus === "Bug Team" ? 0 : 1;
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
  | { ok: false; reason: "NOT_FOUND" | "SPEC_INCOMPLETE" }
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
    const [candidate] = await tx
      .select({
        comparisonKey: discoveryCandidates.comparisonKey,
        specId: discoveryCandidates.specId,
      })
      .from(discoveryCandidates)
      .where(eq(discoveryCandidates.id, id))
      .limit(1);
    if (!candidate) return { ok: false, reason: "NOT_FOUND" };
    if (action === "approve" && (!candidate.comparisonKey || !candidate.specId)) {
      return { ok: false, reason: "SPEC_INCOMPLETE" };
    }

    const reviewedAt = new Date();
    const status = action === "approve" ? "APPROVED" : "REJECTED";
    await tx
      .update(discoveryCandidates)
      .set({
        status,
        rejectionReason: action === "reject" ? reason ?? null : null,
        updatedAt: reviewedAt,
      })
      .where(eq(discoveryCandidates.id, id));
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
