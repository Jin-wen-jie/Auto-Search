"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ClipboardCheck, Cog, LayoutDashboard, LoaderCircle, PackageSearch, Store, Tags } from "lucide-react";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";

const navItems = [
  { href: "/dashboard", label: "总览", icon: LayoutDashboard },
  { href: "/candidates", label: "候选审核", icon: ClipboardCheck },
  { href: "/merchants", label: "商家档案", icon: Store },
  { href: "/specs", label: "商品规格", icon: Tags },
  { href: "/jobs", label: "采集任务", icon: PackageSearch },
  { href: "/settings", label: "系统设置", icon: Cog },
];

export function AdminShell({
  children,
  forcePasswordChange,
}: {
  children: ReactNode;
  forcePasswordChange: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const visibleNavItems = forcePasswordChange
    ? navItems.filter((item) => item.href === "/settings")
    : navItems;

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const items = forcePasswordChange
        ? navItems.filter((item) => item.href === "/settings")
        : navItems;
      items.forEach((item) => router.prefetch(item.href));
    }, 100);
    return () => window.clearTimeout(timer);
  }, [forcePasswordChange, router]);

  function handleNavigation(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      pathname.startsWith(href)
    ) {
      return;
    }
    setPendingHref(href);
  }

  return (
    <div className="min-h-screen bg-gray-100 md:flex md:h-screen">
      <aside className="border-b border-gray-200 bg-white md:flex md:w-56 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="border-b border-gray-200 px-4 py-3 md:px-5 md:py-4">
          <h1 className="text-base font-bold text-gray-900">K12 / Bug Team</h1>
          <p className="text-xs text-gray-500 mt-0.5">教育 AI 商品调查后台</p>
        </div>
        <nav className="flex gap-1 overflow-x-auto p-2 md:block md:flex-1 md:overflow-y-auto">
          {visibleNavItems.map((item) => {
            const active = (pendingHref ?? pathname).startsWith(item.href);
            const pending = pendingHref === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                aria-current={active ? "page" : undefined}
                onClick={(event) => handleNavigation(event, item.href)}
                onFocus={() => router.prefetch(item.href)}
                onMouseEnter={() => router.prefetch(item.href)}
                className={`my-0.5 flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:mx-2 md:gap-2.5 ${active ? "bg-blue-50 text-blue-700" : "text-gray-700 hover:bg-gray-100 hover:text-gray-900"}`}
              >
                {pending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main
        aria-busy={pendingHref !== null}
        className="relative min-w-0 p-3 sm:p-4 md:flex-1 md:overflow-y-auto md:p-6"
      >
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 h-0.5 bg-blue-600 transition-opacity ${pendingHref ? "animate-pulse opacity-100" : "opacity-0"}`}
        />
        {forcePasswordChange && (
          <div className="mb-4 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
            首次登录必须修改初始密码，完成后请重新登录。
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
