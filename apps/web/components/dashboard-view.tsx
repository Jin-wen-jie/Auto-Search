"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "./data-table";
import { ExternalLink } from "./external-link";
import type { RankingView } from "../lib/admin-read-model";

const priceColumns: Column<RankingView>[] = [
  { key: "unitCny", header: "有效单位价", render: (row) => <span className="font-mono text-sm font-bold text-green-700">{row.unitCny}</span> },
  { key: "spec", header: "规格", render: (row) => <span className="text-xs text-gray-800">{row.spec}</span> },
  { key: "merchant", header: "商家", render: (row) => <span className="text-xs font-semibold text-gray-900">{row.merchant}</span> },
  { key: "price", header: "原价", render: (row) => <span className="font-mono text-xs text-gray-700">{row.price}</span> },
  { key: "totalCny", header: "总支出", render: (row) => <span className="font-mono text-xs font-semibold text-gray-900">{row.totalCny}</span> },
  { key: "product", header: "商品页", render: (row) => <ExternalLink href={row.productUrl}>打开</ExternalLink> },
  { key: "source", header: "公开来源", render: (row) => row.sourceUrl ? <ExternalLink href={row.sourceUrl}>来源</ExternalLink> : <span className="text-xs text-gray-500">手工</span> },
  { key: "verified", header: "最后成功核验", render: (row) => <span className="text-xs text-gray-600">{new Date(row.lastVerified).toLocaleString("zh-CN")}</span> },
];

const supplyColumns: Column<RankingView>[] = [
  { key: "evidence", header: "货源证据", render: (row) => <span className="text-xs text-gray-800">{row.supplyEvidence}</span> },
  { key: "confidence", header: "置信度", render: (row) => <span className="font-mono text-xs text-gray-700">{row.confidence === null ? "—" : `${row.confidence}%`}</span> },
  { key: "spec", header: "规格", render: (row) => <span className="text-xs text-gray-800">{row.spec}</span> },
  { key: "merchant", header: "商家", render: (row) => <span className="text-xs font-semibold text-gray-900">{row.merchant}</span> },
  { key: "product", header: "商品页", render: (row) => <ExternalLink href={row.productUrl}>打开</ExternalLink> },
  { key: "source", header: "公开来源", render: (row) => row.sourceUrl ? <ExternalLink href={row.sourceUrl}>来源</ExternalLink> : <span className="text-xs text-gray-500">手工</span> },
  { key: "merchantLink", header: "店铺", render: (row) => row.merchantUrl ? <ExternalLink href={row.merchantUrl}>店铺</ExternalLink> : <span className="text-xs text-gray-500">—</span> },
  { key: "verified", header: "最后成功核验", render: (row) => <span className="text-xs text-gray-600">{new Date(row.lastVerified).toLocaleString("zh-CN")}</span> },
];

export function DashboardView({
  rows,
  counts,
  refresh,
}: {
  rows: RankingView[];
  counts: { candidates: number; merchants: number; listings: number };
  refresh: { attempted: number; updated: number; failures: string[] };
}) {
  const [tab, setTab] = useState<"price" | "supply">("price");
  const router = useRouter();

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div
      data-refresh-attempted={refresh.attempted}
      data-refresh-updated={refresh.updated}
      data-refresh-failures={refresh.failures.join(",")}
    >
      <h2 className="mb-1 text-xl font-bold text-gray-900">K12 / Bug Team 比价总览</h2>
      <p className="mb-4 text-xs text-gray-500">
        PostgreSQL 事实数据：{counts.candidates} 条候选 · {counts.merchants} 个保留商家 · {counts.listings} 条已通过商品。总览直接展示候选审核中点击“通过”的 K12 / Bug Team 商品。
      </p>
      <div className="mb-4 flex gap-2 border-b">
        <button onClick={() => setTab("price")} className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === "price" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}>价格榜</button>
        <button onClick={() => setTab("supply")} className={`border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${tab === "supply" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}>货源证据</button>
      </div>
      <DataTable columns={tab === "price" ? priceColumns : supplyColumns} rows={rows} getRowKey={(row) => row.id} />
    </div>
  );
}
