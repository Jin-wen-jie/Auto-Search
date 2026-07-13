import type { createJobHandlers } from "./job-handlers.js";
import { QUEUES } from "./queue.js";

export type BatchQueue =
  | typeof QUEUES.VALIDATE_CANDIDATE
  | typeof QUEUES.REVALIDATE_LISTING;

export interface BatchResult {
  candidates: { attempted: number; succeeded: number; failed: number };
  listings: { attempted: number; succeeded: number; failed: number };
  timedOut: boolean;
}

interface BatchOptions {
  createHandlers: (
    enqueue: (queue: BatchQueue, id: string) => Promise<void>,
  ) => ReturnType<typeof createJobHandlers>;
  candidateLimit: number;
  listingLimit: number;
  concurrency: number;
  deadlineMs: number;
  now?: () => number;
}

type BatchTask =
  | { queue: typeof QUEUES.VALIDATE_CANDIDATE; id: string }
  | { queue: typeof QUEUES.REVALIDATE_LISTING; id: string };

export async function runWorkerBatch(
  options: BatchOptions,
): Promise<BatchResult> {
  const now = options.now ?? Date.now;
  const deadlineAt = now() + options.deadlineMs;
  const candidateIds: string[] = [];
  const listingIds: string[] = [];
  const seenCandidateIds = new Set<string>();
  const seenListingIds = new Set<string>();
  const result: BatchResult = {
    candidates: { attempted: 0, succeeded: 0, failed: 0 },
    listings: { attempted: 0, succeeded: 0, failed: 0 },
    timedOut: false,
  };
  let wakeWorkers: () => void = () => undefined;
  let queueChanged = new Promise<void>((resolve) => {
    wakeWorkers = resolve;
  });
  const signalQueueChange = () => {
    wakeWorkers();
    queueChanged = new Promise<void>((resolve) => {
      wakeWorkers = resolve;
    });
  };

  const enqueue = async (queue: BatchQueue, id: string): Promise<void> => {
    if (queue === QUEUES.VALIDATE_CANDIDATE) {
      if (!seenCandidateIds.has(id)) {
        seenCandidateIds.add(id);
        candidateIds.push(id);
        signalQueueChange();
      }
      return;
    }
    if (queue === QUEUES.REVALIDATE_LISTING) {
      if (!seenListingIds.has(id)) {
        seenListingIds.add(id);
        listingIds.push(id);
        signalQueueChange();
      }
      return;
    }
    throw new Error("UNSUPPORTED_BATCH_QUEUE");
  };

  const handlers = options.createHandlers(enqueue);
  await handlers.sweepCandidates();
  await handlers.sweepListings();

  let preferCandidates = true;
  let activeTasks = 0;
  const takeTask = (): BatchTask | undefined => {
    if (now() >= deadlineAt) {
      result.timedOut = true;
      return undefined;
    }

    const takeCandidate = (): BatchTask | undefined => {
      if (result.candidates.attempted >= options.candidateLimit) {
        return undefined;
      }
      const id = candidateIds.shift();
      if (id === undefined) return undefined;
      result.candidates.attempted++;
      activeTasks++;
      preferCandidates = false;
      return { queue: QUEUES.VALIDATE_CANDIDATE, id };
    };
    const takeListing = (): BatchTask | undefined => {
      if (result.listings.attempted >= options.listingLimit) {
        return undefined;
      }
      const id = listingIds.shift();
      if (id === undefined) return undefined;
      result.listings.attempted++;
      activeTasks++;
      preferCandidates = true;
      return { queue: QUEUES.REVALIDATE_LISTING, id };
    };

    return preferCandidates
      ? takeCandidate() ?? takeListing()
      : takeListing() ?? takeCandidate();
  };

  const work = async (): Promise<void> => {
    while (true) {
      const task = takeTask();
      if (!task) {
        if (result.timedOut || activeTasks === 0) return;
        await queueChanged;
        continue;
      }

      if (task.queue === QUEUES.VALIDATE_CANDIDATE) {
        try {
          await handlers.validateCandidate({ candidateId: task.id });
          result.candidates.succeeded++;
        } catch {
          result.candidates.failed++;
        }
      } else {
        try {
          await handlers.revalidateListing({ listingId: task.id });
          result.listings.succeeded++;
        } catch {
          result.listings.failed++;
        }
      }
      activeTasks--;
      signalQueueChange();
    }
  };

  await Promise.all(
    Array.from({ length: options.concurrency }, () => work()),
  );

  return result;
}
