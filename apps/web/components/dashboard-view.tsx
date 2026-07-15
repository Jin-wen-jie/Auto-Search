"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable, type Column } from "./data-table";
import { ExternalLink } from "./external-link";
import type { RankingView } from "../lib/admin-read-model";

const LIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1_000;

const priceColumns: Column<RankingView>[] = [
  { key: "unitCny", header: "有效单位价", render: (row) => <span className="font-mono text-sm font-bold text-green-700">{row.unitCny}</span> },
  { key: "spec", header: "规格", render: (row) => <span className="text-xs text-gray-800">{row.spec}</span> },
  { key: "merchant", header: "商家", render: (row) => <span className="text-xs font-semibold text-gray-900">{row.merchant}</span> },
  { key: "availability", header: "库存", render: (row) => <AvailabilityBadge availability={row.availability} /> },
  { key: "price", header: "原价", render: (row) => <span className="font-mono text-xs text-gray-700">{row.price}</span> },
  { key: "totalCny", header: "总支出", render: (row) => <span className="font-mono text-xs font-semibold text-gray-900">{row.totalCny}</span> },
  { key: "product", header: "商品页", render: (row) => <ExternalLink href={row.productUrl}>打开</ExternalLink> },
  { key: "source", header: "公开来源", render: (row) => row.sourceUrl ? <ExternalLink href={row.sourceUrl}>来源</ExternalLink> : <span className="text-xs text-gray-500">手工</span> },
  { key: "verified", header: "最后成功核验", render: (row) => <span className="text-xs text-gray-600">{new Date(row.lastVerified).toLocaleString("zh-CN")}</span> },
];

const supplyColumns: Column<RankingView>[] = [
  { key: "availability", header: "库存", render: (row) => <AvailabilityBadge availability={row.availability} /> },
  { key: "evidence", header: "货源证据", render: (row) => <span className="text-xs text-gray-800">{row.supplyEvidence}</span> },
  { key: "confidence", header: "置信度", render: (row) => <span className="font-mono text-xs text-gray-700">{row.confidence === null ? "—" : `${row.confidence}%`}</span> },
  { key: "spec", header: "规格", render: (row) => <span className="text-xs text-gray-800">{row.spec}</span> },
  { key: "merchant", header: "商家", render: (row) => <span className="text-xs font-semibold text-gray-900">{row.merchant}</span> },
  { key: "product", header: "商品页", render: (row) => <ExternalLink href={row.productUrl}>打开</ExternalLink> },
  { key: "source", header: "公开来源", render: (row) => row.sourceUrl ? <ExternalLink href={row.sourceUrl}>来源</ExternalLink> : <span className="text-xs text-gray-500">手工</span> },
  { key: "merchantLink", header: "店铺", render: (row) => row.merchantUrl ? <ExternalLink href={row.merchantUrl}>店铺</ExternalLink> : <span className="text-xs text-gray-500">—</span> },
  { key: "verified", header: "最后成功核验", render: (row) => <span className="text-xs text-gray-600">{new Date(row.lastVerified).toLocaleString("zh-CN")}</span> },
];

function AvailabilityBadge({
  availability,
}: {
  availability: RankingView["availability"];
}) {
  const display = availability === "IN_STOCK"
    ? { label: "有货", className: "bg-green-100 text-green-800" }
    : availability === "OUT_OF_STOCK"
      ? { label: "无货", className: "bg-red-100 text-red-800" }
      : { label: "待核验", className: "bg-gray-100 text-gray-700" };

  return (
    <span
      className={`inline-flex min-w-12 items-center justify-center rounded px-2 py-1 text-xs font-semibold ${display.className}`}
    >
      {display.label}
    </span>
  );
}

export function DashboardView({
  rows,
  counts,
}: {
  rows: RankingView[];
  counts: { candidates: number; merchants: number; listings: number };
}) {
  const [tab, setTab] = useState<"price" | "supply">("price");
  const [refreshDiagnostic, setRefreshDiagnostic] = useState({
    attempted: 0,
    updated: 0,
    failures: "",
  });
  const router = useRouter();
  const rowsRef = useRef(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  useEffect(() => {
    let stopped = false;
    let running = false;
    const refreshPrices = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      const targets = rowsRef.current.filter(
        (row) =>
          Date.now() - new Date(row.lastVerified).getTime() >=
            LIVE_REFRESH_INTERVAL_MS,
      );
      let updated = 0;
      const failures = new Set<string>();
      for (const row of targets) {
        try {
          if (await refreshLdxpCandidate(row)) updated++;
          else failures.add("NOT_UPDATED");
        } catch (error) {
          failures.add(clientFailureCategory(error));
        }
      }
      running = false;
      setRefreshDiagnostic({
        attempted: targets.length,
        updated,
        failures: [...failures].join(","),
      });
      if (
        !stopped &&
        updated > 0
      ) {
        router.refresh();
      }
    };
    void refreshPrices();
    const timer = window.setInterval(refreshPrices, LIVE_REFRESH_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [router]);

  return (
    <div
      data-client-refresh-attempted={refreshDiagnostic.attempted}
      data-client-refresh-updated={refreshDiagnostic.updated}
      data-client-refresh-failures={refreshDiagnostic.failures}
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

async function refreshLdxpCandidate(row: RankingView): Promise<boolean> {
  const productUrl = new URL(row.productUrl);
  const match = productUrl.pathname.match(/^\/item\/([A-Za-z0-9]+)\/?$/);
  if (productUrl.origin !== "https://pay.ldxp.cn" || !match?.[1]) return false;

  const goodsKey = match[1];
  const goodsResult = await postLdxp("/shopApi/Shop/goodsInfo", {
    goods_key: goodsKey,
    trade_no: null,
  });
  const goods = recordValue(goodsResult.data);
  const user = recordValue(goods.user);
  if (
    goodsResult.code !== 1 ||
    goods.goods_key !== goodsKey ||
    typeof goods.name !== "string" ||
    typeof goods.price !== "number" ||
    typeof goods.status !== "number" ||
    typeof user.nickname !== "string" ||
    typeof user.token !== "string" ||
    typeof user.link !== "string"
  ) throw new Error("INVALID_GOODS_RESPONSE");

  const channelResult = await postLdxp("/shopApi/Shop/getUserChannel", {
    token: user.token,
  });
  const channels = Array.isArray(channelResult.data) ? channelResult.data : [];
  const firstChannel = recordValue(channels[0]);
  const channelId = typeof firstChannel.id === "number" ? firstChannel.id : 0;
  const priceResult = await postLdxp("/shopApi/Shop/getGoodsPrice", {
    goods_key: goodsKey,
    quantity: 1,
    coupon_code: "",
    channel_id: channelId,
  });
  const checkout = recordValue(priceResult.data);
  if (
    priceResult.code !== 1 ||
    typeof checkout.original_amount !== "number" ||
    typeof checkout.total_amount !== "number"
  ) throw new Error("INVALID_PRICE_RESPONSE");
  const availability = await probeLdxpAvailability(
    goodsKey,
    goods.status,
    checkout.total_amount,
  );

  const response = await fetch("/api/candidates", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": readCsrfToken(),
    },
    body: JSON.stringify({
      id: row.id,
      snapshot: {
        price: goods.price,
        totalPrice: checkout.total_amount,
        mandatoryFee: Math.max(
          0,
          Math.round((checkout.total_amount - checkout.original_amount) * 100) /
            100,
        ),
        pageTitle: goods.name,
        merchantName: user.nickname,
        merchantUrl: user.link,
        availability,
      },
    }),
  });
  if (!response.ok) throw new Error(`WRITE_HTTP_${response.status}`);
  return response.ok;
}

async function probeLdxpAvailability(
  goodsKey: string,
  goodsStatus: number,
  totalAmount: number,
): Promise<RankingView["availability"]> {
  if (goodsStatus !== 1) return "OUT_OF_STOCK";
  if (totalAmount === 0) return "UNKNOWN";

  const probe = await postLdxp("/shopApi/Pay/order", {
    goods_key: goodsKey,
    quantity: 1,
    coupon_code: "",
    channel_id: 0,
    contact: "inventory-probe",
    extend: {},
  });
  if (probe.code !== 0) throw new Error("LDXP_ORDER_PROBE_UNEXPECTED_SUCCESS");
  return isOutOfStockMessage(probe.msg) ? "OUT_OF_STOCK" : "IN_STOCK";
}

function isOutOfStockMessage(message: unknown): boolean {
  return typeof message === "string" &&
    /库存不足|库存不够|无库存|缺货|售罄|已售完/.test(message);
}

async function postLdxp(
  path: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`https://www.ldxp.cn${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`LDXP_HTTP_${response.status}`);
  return recordValue(await response.json());
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readCsrfToken(): string {
  for (const name of ["__Host-admin_csrf", "admin_csrf"]) {
    const prefix = `${name}=`;
    const cookie = document.cookie
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(prefix));
    if (cookie) return decodeURIComponent(cookie.slice(prefix.length));
  }
  return "";
}

function clientFailureCategory(error: unknown): string {
  if (!(error instanceof Error)) return "CLIENT_REFRESH_FAILED";
  if (/^[A-Z0-9_]+$/.test(error.message)) return error.message;
  if (error instanceof TypeError) return "BROWSER_FETCH_FAILED";
  if (error.name === "TimeoutError") return "TIMEOUT";
  return "CLIENT_REFRESH_FAILED";
}
