import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 单管理员调查后台 — 无需登录
export default function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
