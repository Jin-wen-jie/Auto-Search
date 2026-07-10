import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateSessionToken,
  hashToken,
  loginPolicy,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Demo credential check — in production, this queries the DB
const DEMO_USERNAME = process.env.ADMIN_INITIAL_USERNAME ?? "owner";
const DEMO_PASSWORD =
  process.env.ADMIN_INITIAL_PASSWORD ?? "CHANGE-ME-AT-FIRST-LOGIN";

export async function POST(request: Request) {
  const body = loginSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 },
    );
  }

  const { username, password } = body.data;

  // Validate credentials (demo — uses env vars for now)
  if (username !== DEMO_USERNAME || password !== DEMO_PASSWORD) {
    return NextResponse.json(
      { error: "用户名或密码错误" },
      { status: 401 },
    );
  }

  // Create session
  const token = generateSessionToken();
  const tokenHash = hashToken(token);

  // Set session cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    ...sessionCookieOptions(process.env.NODE_ENV === "production"),
  });

  // Check if force password change is needed
  const forcePasswordChange =
    password === "CHANGE-ME-AT-FIRST-LOGIN" ||
    DEMO_PASSWORD === "CHANGE-ME-AT-FIRST-LOGIN";

  return NextResponse.json({
    ok: true,
    forcePasswordChange,
  });
}
