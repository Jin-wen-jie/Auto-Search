import { QUEUES, getQueueConfig } from "../queue.js";
import type { CheckFailureKind } from "../lifecycle.js";
import { transitionListing } from "../lifecycle.js";
import { validateUrl } from "../validator-client.js";
import type { ValidatorResponse } from "../validator-client.js";

export interface JobContext {
  baseUrl: string;
  token: string;
}

// Revalidate job — checks a listing's URL and transitions state
export async function revalidateListing(
  listingId: string,
  url: string,
  currentStatus: string,
  consecutiveFailures: number,
  lastSuccessAgeHours: number,
  ctx: JobContext,
): Promise<{ status: string; observation: ValidatorResponse | null }> {
  try {
    const result = await validateUrl(url, ctx.baseUrl, ctx.token);
    return { status: "ACTIVE", observation: result };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const kind = classifyFailure(msg);
    const result = transitionListing(
      {
        status: currentStatus as "ACTIVE",
        consecutiveFailures,
        lastSuccessAgeHours,
      },
      { kind },
    );
    return { status: result.status, observation: null };
  }
}

function classifyFailure(message: string): CheckFailureKind {
  const m = message.toLowerCase();
  if (m.includes("404") || m.includes("not found")) return "HTTP_404";
  if (m.includes("410")) return "HTTP_410";
  if (m.includes("login") || m.includes("sign in")) return "LOGIN_WALL";
  if (m.includes("captcha") || m.includes("verify")) return "CAPTCHA";
  if (m.includes("401") || m.includes("unauthorized")) return "HTTP_401";
  if (m.includes("403") || m.includes("forbidden") || m.includes("robots"))
    return "HTTP_403";
  if (m.includes("timeout") || m.includes("abort")) return "TIMEOUT";
  if (m.includes("dns") || m.includes("resolve")) return "DNS_FAILURE";
  if (m.includes("tls") || m.includes("certificate")) return "TLS_ERROR";
  if (m.includes("500") || m.includes("502") || m.includes("503"))
    return "HTTP_5XX";
  return "TIMEOUT"; // default for unknown transient
}

// Discover job placeholder — runs a source connector
export async function discoverSource(
  sourceId: string,
  platform: string,
  _ctx: JobContext,
): Promise<{ discovered: number; deduped: number; error: string | null }> {
  // In production, this invokes the actual connector (X or Telegram)
  // For now, returns a placeholder result
  // eslint-disable-next-line no-console
  console.log(`Discovering from ${platform} source ${sourceId}`);
  return { discovered: 0, deduped: 0, error: null };
}

// Export queue config for worker bootstrap
export { QUEUES, getQueueConfig };
