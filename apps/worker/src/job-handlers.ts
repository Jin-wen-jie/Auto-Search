import { transitionListing, type CheckFailureKind } from "./lifecycle.js";
import { QUEUES } from "./queue.js";
import type { ValidatorResponse } from "./validator-client.js";

export interface CandidateForValidation {
  id: string;
  productUrl: string;
}

export interface ListingForRevalidation {
  id: string;
  originalUrl: string;
  status: "ACTIVE" | "OUT_OF_STOCK" | "INVALID" | "RECHECK" | "NEEDS_REVIEW";
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
}

export interface ListingValidationResult {
  status: ListingForRevalidation["status"];
  consecutiveFailures: number;
  observation: ValidatorResponse | null;
  failureKind: CheckFailureKind | null;
  failure: unknown;
}

export interface WorkerRepository {
  listCandidateIdsForValidation: (limit?: number) => Promise<string[]>;
  getCandidateForValidation: (
    id: string,
  ) => Promise<CandidateForValidation | null>;
  markCandidateValidating: (id: string) => Promise<void>;
  saveCandidateValidation: (
    id: string,
    result: ValidatorResponse,
  ) => Promise<void>;
  saveCandidateFailure: (id: string, error: unknown) => Promise<void>;
  saveDiscoveredPlatformLinks: (links: string[]) => Promise<string[]>;
  listListingIdsForRevalidation: (limit?: number) => Promise<string[]>;
  getListingForRevalidation: (
    id: string,
  ) => Promise<ListingForRevalidation | null>;
  saveListingRevalidation: (
    id: string,
    result: ListingValidationResult,
  ) => Promise<void>;
}

type EntityQueue =
  | typeof QUEUES.VALIDATE_CANDIDATE
  | typeof QUEUES.REVALIDATE_LISTING;

interface JobHandlerDependencies {
  repository: WorkerRepository;
  validate: (url: string) => Promise<ValidatorResponse>;
  enqueue: (queue: EntityQueue, id: string) => Promise<unknown>;
  now?: () => Date;
}

export function createJobHandlers(dependencies: JobHandlerDependencies) {
  const now = dependencies.now ?? (() => new Date());

  return {
    async validateCandidate(input: { candidateId: string }) {
      const candidate = await dependencies.repository.getCandidateForValidation(
        input.candidateId,
      );
      if (!candidate) return { status: "missing" as const };

      await dependencies.repository.markCandidateValidating(candidate.id);
      try {
        const result = await dependencies.validate(candidate.productUrl);
        await dependencies.repository.saveCandidateValidation(
          candidate.id,
          result,
        );
        // Discover other shops on the same platform
        const discovered = result.extraction.platformLinks ?? [];
        if (discovered.length > 0) {
          const ids = await dependencies.repository.saveDiscoveredPlatformLinks(
            discovered,
          );
          if (ids.length > 0) {
            await Promise.all(
              ids.map((id) =>
                dependencies.enqueue(QUEUES.VALIDATE_CANDIDATE, id),
              ),
            );
          }
        }
        return { status: "validated" as const };
      } catch (error) {
        await dependencies.repository.saveCandidateFailure(candidate.id, error);
        throw error;
      }
    },

    async sweepCandidates() {
      const ids = await dependencies.repository.listCandidateIdsForValidation();
      await Promise.all(
        ids.map((id) =>
          dependencies.enqueue(QUEUES.VALIDATE_CANDIDATE, id),
        ),
      );
      return { queued: ids.length };
    },

    async revalidateListing(input: { listingId: string }) {
      const listing = await dependencies.repository.getListingForRevalidation(
        input.listingId,
      );
      if (!listing) return { status: "missing" as const };

      let result: ListingValidationResult;
      try {
        const observation = await dependencies.validate(listing.originalUrl);
        result = {
          status: observation.extraction.availability === "OUT_OF_STOCK"
            ? "OUT_OF_STOCK"
            : "ACTIVE",
          consecutiveFailures: 0,
          observation,
          failureKind: null,
          failure: null,
        };
      } catch (error) {
        const failureKind = classifyFailure(error);
        const lastSuccessAgeHours = listing.lastSuccessAt
          ? (now().getTime() - listing.lastSuccessAt.getTime()) / 3_600_000
          : 25;
        const transition = transitionListing(
          {
            status: listing.status,
            consecutiveFailures: listing.consecutiveFailures,
            lastSuccessAgeHours,
          },
          { kind: failureKind },
        );
        result = {
          status: transition.status,
          consecutiveFailures: transition.consecutiveFailures,
          observation: null,
          failureKind,
          failure: error,
        };
      }
      await dependencies.repository.saveListingRevalidation(listing.id, result);
      return { status: result.status };
    },

    async sweepListings() {
      const ids = await dependencies.repository.listListingIdsForRevalidation();
      await Promise.all(
        ids.map((id) =>
          dependencies.enqueue(QUEUES.REVALIDATE_LISTING, id),
        ),
      );
      return { queued: ids.length };
    },
  };
}

function classifyFailure(error: unknown): CheckFailureKind {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("404") || message.includes("not found")) return "HTTP_404";
  if (message.includes("410")) return "HTTP_410";
  if (message.includes("login") || message.includes("sign in")) return "LOGIN_WALL";
  if (message.includes("captcha") || message.includes("verify")) return "CAPTCHA";
  if (message.includes("401") || message.includes("unauthorized")) return "HTTP_401";
  if (message.includes("403") || message.includes("forbidden")) return "HTTP_403";
  if (message.includes("dns") || message.includes("resolve")) return "DNS_FAILURE";
  if (message.includes("tls") || message.includes("certificate")) return "TLS_ERROR";
  if (message.includes("5") && message.includes("http")) return "HTTP_5XX";
  return "TIMEOUT";
}
