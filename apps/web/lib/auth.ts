import { createHash, randomBytes } from "node:crypto";

// ── Login policy ──

export interface AccountState {
  failedAttempts: number;
  lockedUntil: Date | null;
}

export interface LoginPolicyResult {
  allowed: boolean;
  reason?: string;
}

const MAX_FAILED_ATTEMPTS = 5;
// Lock duration: 15 minutes, applied externally when setting lockedUntil

export function loginPolicy(
  account: AccountState,
  now: Date = new Date(),
): LoginPolicyResult {
  if (account.lockedUntil && account.lockedUntil > now) {
    return {
      allowed: false,
      reason: `Account locked until ${account.lockedUntil.toISOString()}`,
    };
  }

  if (account.failedAttempts >= MAX_FAILED_ATTEMPTS) {
    return {
      allowed: false,
      reason: "Too many failed attempts",
    };
  }

  return { allowed: true };
}

// ── Session tokens ──

export function generateSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ── CSRF ──

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function assertCsrf(
  cookieToken: string,
  formToken: string,
): void {
  if (cookieToken !== formToken) {
    throw new Error("CSRF_MISMATCH");
  }
}

// ── Cookie helpers ──

export const SESSION_COOKIE = "admin_session";

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 24, // 24 hours
  };
}

// ── Origin check ──

export function isSameOrigin(
  originHeader: string | null,
  expectedOrigin: string,
): boolean {
  if (!originHeader) return false;
  return originHeader === expectedOrigin;
}
