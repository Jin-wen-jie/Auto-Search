import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentAdminSession } from "../lib/server-auth";

export default async function PasswordChangeGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCurrentAdminSession();
  if (!session) redirect("/login");
  if (session.forcePasswordChange) {
    redirect("/settings?forcePasswordChange=1");
  }
  return <Suspense fallback={<RouteLoading />}>{children}</Suspense>;
}

function RouteLoading() {
  return (
    <div role="status" className="space-y-4" aria-live="polite">
      <span className="sr-only">正在加载页面</span>
      <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
      <div className="h-3 w-80 max-w-full animate-pulse rounded bg-gray-200" />
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="h-10 animate-pulse border-b border-gray-200 bg-gray-100" />
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-11 animate-pulse border-b border-gray-100 bg-white last:border-b-0"
          />
        ))}
      </div>
    </div>
  );
}
