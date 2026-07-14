import { cookies } from "next/headers";
import { cache } from "react";
import { hashToken } from "./auth";
import { getAdminAuthRepository } from "./auth-repository";
import { authorizeAdminSession } from "./auth-service";
import { assertCsrfRequest } from "./csrf-guard";

export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-admin_session" : "admin_session";
export const CSRF_COOKIE = process.env.NODE_ENV === "production" ? "__Host-admin_csrf" : "admin_csrf";

export function sessionCookieOptions(expiresAt: Date) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", expires: expiresAt };
}

export function csrfCookieOptions(expiresAt: Date) {
  return { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", expires: expiresAt };
}

export const getCurrentAdminSession = cache(async function getCurrentAdminSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const repository = await getAdminAuthRepository();
  const session = await authorizeAdminSession(repository, token);
  return session ? { ...session, tokenHash: hashToken(token) } : null;
});

export async function authorizeAdminRequest(options?: {
  allowPasswordChangeRequired?: boolean;
}) {
  const session = await getCurrentAdminSession();
  if (!session) {
    return {
      ok: false as const,
      status: 401,
      error: "UNAUTHENTICATED" as const,
    };
  }
  if (session.forcePasswordChange && !options?.allowPasswordChangeRequired) {
    return {
      ok: false as const,
      status: 403,
      error: "PASSWORD_CHANGE_REQUIRED" as const,
    };
  }
  return { ok: true as const, session };
}

export async function assertAdminMutation(
  request: Request,
  options?: { allowPasswordChangeRequired?: boolean },
) {
  const authorization = await authorizeAdminRequest(options);
  if (!authorization.ok) return authorization;
  const cookieStore = await cookies();
  try {
    assertCsrfRequest({
      csrfToken: request.headers.get("x-csrf-token") ?? cookieStore.get(CSRF_COOKIE)?.value ?? null,
      csrfTokenHash: authorization.session.csrfTokenHash,
      origin: request.headers.get("origin"),
      expectedOrigin: new URL(request.url).origin,
    });
    return authorization;
  } catch {
    return {
      ok: false as const,
      status: 403,
      error: "INVALID_CSRF" as const,
    };
  }
}
