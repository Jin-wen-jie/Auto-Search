"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { DataTable } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import { StatusBadge } from "../../../components/status-badge";
import type { Column } from "../../../components/data-table";

interface Candidate {
  id: string; productUrl: string; sourceType: "manual" | "x" | "telegram";
  status: string; title: string | null; price: string | null;
  merchantName: string | null; sourceUrl: string | null; merchantUrl: string | null;
  focus: string | null; availability: string | null; evidenceNote: string | null;
  observedAt: string | null; sold: number | null; inventory: number | null;
  createdAt: string;
}

interface CandidatePage {
  items: Candidate[];
  page: number;
  pageSize: number;
  total: number;
}

const PRICE_SYNC_INTERVAL_MS = 5 * 60 * 1_000;
const PRICE_SYNC_CONCURRENCY = 4;

function readCsrfToken(): string {
  for (const name of ["__Host-admin_csrf", "admin_csrf"]) {
    const prefix = `${name}=`;
    const cookie = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(prefix));
    if (cookie) return decodeURIComponent(cookie.slice(prefix.length));
  }
  return "";
}

export default function CandidatesClient({
  initialPage,
}: {
  initialPage: CandidatePage;
}) {
  const [candidates, setCandidates] = useState(initialPage.items);
  const [page, setPage] = useState(initialPage.page);
  const [total, setTotal] = useState(initialPage.total);
  const pageSize = initialPage.pageSize;
  const [loading, setLoading] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const reviewingIdsRef = useRef(new Set<string>());
  const [reviewingIds, setReviewingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [error, setError] = useState("");
  const candidatesRef = useRef(initialPage.items);
  const syncRunningRef = useRef(false);

  useEffect(() => {
    candidatesRef.current = candidates;
  }, [candidates]);

  useEffect(() => {
    void synchronizeCandidates();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void synchronizeCandidates();
      }
    }, PRICE_SYNC_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  async function synchronizeCandidates(items = candidatesRef.current) {
    if (syncRunningRef.current) return;
    syncRunningRef.current = true;
    try {
      const refreshed = await syncCandidatePrices(items);
      const refreshedById = new Map(
        refreshed.map((candidate) => [candidate.id, candidate]),
      );
      setCandidates((current) =>
        current.map((candidate) => refreshedById.get(candidate.id) ?? candidate)
      );
    } finally {
      syncRunningRef.current = false;
    }
  }

  async function fetchCandidates(nextPage = page) {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/candidates?page=${nextPage}&pageSize=${pageSize}`,
      );
      const data = (await res.json()) as Partial<CandidatePage> & {
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.items)) {
        throw new Error(data.error ?? "加载失败");
      }
      setCandidates(data.items);
      candidatesRef.current = data.items;
      void synchronizeCandidates(data.items);
      setPage(data.page ?? nextPage);
      setTotal(data.total ?? 0);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "加载失败");
    } finally { setLoading(false); }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newUrl) return;
    setAdding(true);
    setError("");
    try {
      const response = await fetch("/api/candidates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": readCsrfToken(),
        },
        body: JSON.stringify({ productUrl: newUrl }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "添加失败");
      setNewUrl("");
      await fetchCandidates(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "添加失败");
    } finally { setAdding(false); }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function handleReview(id: string, action: "approve" | "reject") {
    if (reviewingIdsRef.current.has(id)) return;
    const previousStatus = candidates.find((candidate) => candidate.id === id)?.status;
    if (!previousStatus) return;

    setError("");
    reviewingIdsRef.current.add(id);
    setReviewingIds(new Set(reviewingIdsRef.current));
    setCandidates((current) =>
      current.filter((candidate) => candidate.id !== id),
    );
    setTotal((current) => Math.max(0, current - 1));

    try {
      const response = await fetch(`/api/candidates/${id}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": readCsrfToken(),
        },
        body: JSON.stringify({ action }),
      });
      const result = (await response.json()) as {
        error?: string;
        status?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "审核失败");
      await fetchCandidates(page);
    } catch (cause) {
      await fetchCandidates(page);
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      reviewingIdsRef.current.delete(id);
      setReviewingIds(new Set(reviewingIdsRef.current));
    }
  }

  const cols: Column<Candidate>[] = [
    { key: "title", header: "商品", render: (r) => <div><div className="font-semibold text-gray-900">{r.title ?? <span className="italic text-gray-500">待抽取</span>}</div>{r.price && <span className="font-mono text-xs text-gray-600">{r.price}</span>}</div> },
    { key: "merchant", header: "商家", render: (r) => <span className="text-gray-800">{r.merchantName ?? <span className="text-gray-400">—</span>}</span> },
    { key: "focus", header: "关注", render: (r) => r.focus ? <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{r.focus}</span> : <span className="text-gray-400">—</span> },
    { key: "evidence", header: "公开证据", render: (r) => <div className="max-w-xs text-xs text-gray-700"><div>{r.evidenceNote ?? r.availability ?? "待进一步核验"}</div>{(r.sold !== null || r.inventory !== null) && <div className="mt-1 font-mono text-gray-500">已售 {r.sold ?? "—"} · 库存 {r.inventory ?? "—"}</div>}{r.observedAt && <div className="mt-1 text-gray-500">核验：{new Date(r.observedAt).toLocaleString("zh-CN")}</div>}</div> },
    { key: "sourceType", header: "来源", render: (r) => <span className="font-medium text-gray-700">{r.sourceType.toUpperCase()}</span> },
    { key: "status", header: "状态", render: (r) => <StatusBadge status={r.status} /> },
    { key: "product", header: "商品页", render: (r) => <ExternalLink href={r.productUrl}>商品页</ExternalLink> },
    { key: "source", header: "发现帖", render: (r) => r.sourceUrl ? <ExternalLink href={r.sourceUrl}>来源帖</ExternalLink> : <span className="text-gray-400">手工录入</span> },
    { key: "merchantLink", header: "店铺", render: (r) => r.merchantUrl ? <ExternalLink href={r.merchantUrl}>店铺</ExternalLink> : <span className="text-gray-400">—</span> },
    { key: "actions", header: "操作", render: (r) => reviewingIds.has(r.id) ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600"><LoaderCircle className="h-4 w-4 animate-spin" />保存中</span> : (r.status === "REVIEW_REQUIRED" || r.status === "DISCOVERED") ? <div className="flex gap-1.5"><button onClick={() => handleReview(r.id, "approve")} className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700">通过</button><button onClick={() => handleReview(r.id, "reject")} className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700">驳回</button></div> : null },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-xl font-bold text-gray-900">K12 / Bug Team 候选审核</h2>
        <form onSubmit={handleAdd} className="flex min-w-0 gap-2 sm:max-w-lg sm:flex-1 sm:justify-end">
          <input type="url" className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none sm:max-w-sm" placeholder="输入商品 URL 手工补链" value={newUrl} onChange={(e) => setNewUrl(e.target.value)} />
          <button type="submit" disabled={adding || !newUrl} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40">添加</button>
        </form>
      </div>
      {error && <div className="mb-4 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div>}
      <div className={loading ? "pointer-events-none opacity-60" : undefined}>
        <DataTable columns={cols} rows={candidates} getRowKey={(r) => r.id} />
      </div>
      <div className="mt-3 flex min-h-9 items-center justify-between gap-3 text-xs text-gray-600">
        <span>第 {page} / {totalPages} 页，共 {total} 条</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="上一页"
            title="上一页"
            disabled={loading || page <= 1}
            onClick={() => fetchCandidates(page - 1)}
            className="grid h-8 w-8 place-items-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="下一页"
            title="下一页"
            disabled={loading || page >= totalPages}
            onClick={() => fetchCandidates(page + 1)}
            className="grid h-8 w-8 place-items-center rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

async function syncCandidatePrices(items: Candidate[]): Promise<Candidate[]> {
  const refreshed: Candidate[] = [];
  for (let index = 0; index < items.length; index += PRICE_SYNC_CONCURRENCY) {
    refreshed.push(
      ...await Promise.all(
        items.slice(index, index + PRICE_SYNC_CONCURRENCY).map(
          syncCandidatePrice,
        ),
      ),
    );
  }
  return refreshed;
}

async function syncCandidatePrice(candidate: Candidate): Promise<Candidate> {
  const goodsKey = ldxpGoodsKey(candidate.productUrl);
  if (!goodsKey) return candidate;

  try {
    const goodsRoot = await postLdxp("/shopApi/Shop/goodsInfo", {
      goods_key: goodsKey,
      trade_no: null,
    });
    const goods = recordValue(goodsRoot.data);
    const user = recordValue(goods.user);
    if (
      goodsRoot.code !== 1 ||
      goods.goods_key !== goodsKey ||
      typeof goods.name !== "string" ||
      typeof goods.price !== "number" ||
      typeof goods.status !== "number" ||
      typeof user.nickname !== "string" ||
      typeof user.token !== "string"
    ) return candidate;

    const channelRoot = await postLdxp("/shopApi/Shop/getUserChannel", {
      token: user.token,
    });
    const channels = Array.isArray(channelRoot.data) ? channelRoot.data : [];
    const firstChannel = recordValue(channels[0]);
    const channelId = typeof firstChannel.id === "number" ? firstChannel.id : 0;
    const priceRoot = await postLdxp("/shopApi/Shop/getGoodsPrice", {
      goods_key: goodsKey,
      quantity: 1,
      coupon_code: "",
      channel_id: channelId,
    });
    const checkout = recordValue(priceRoot.data);
    if (
      priceRoot.code !== 1 ||
      typeof checkout.original_amount !== "number" ||
      typeof checkout.total_amount !== "number"
    ) return candidate;
    const availability = await probeLdxpAvailability(
      goodsKey,
      goods.status,
      checkout.total_amount,
    );

    const merchantUrl = verifiedLdxpMerchantUrl(user.link) ??
      candidate.merchantUrl;
    const observedAt = new Date().toISOString();
    const refreshed = {
      ...candidate,
      title: goods.name,
      price: String(goods.price),
      merchantName: user.nickname,
      merchantUrl,
      availability,
      observedAt,
    };
    if (merchantUrl) {
      await persistCandidateSnapshot(candidate.id, {
        price: goods.price,
        totalPrice: checkout.total_amount,
        mandatoryFee: Math.max(
          0,
          Math.round((checkout.total_amount - checkout.original_amount) * 100) /
            100,
        ),
        pageTitle: goods.name,
        merchantName: user.nickname,
        merchantUrl,
        availability: refreshed.availability,
      });
    }
    return refreshed;
  } catch {
    return candidate;
  }
}

async function probeLdxpAvailability(
  goodsKey: string,
  goodsStatus: number,
  totalAmount: number,
): Promise<"IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN"> {
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

async function persistCandidateSnapshot(
  id: string,
  snapshot: Record<string, unknown>,
): Promise<void> {
  const response = await fetch("/api/candidates", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": readCsrfToken(),
    },
    body: JSON.stringify({ id, snapshot }),
  });
  if (!response.ok) throw new Error(`WRITE_HTTP_${response.status}`);
}

function ldxpGoodsKey(productUrl: string): string | null {
  const url = new URL(productUrl);
  const match = url.pathname.match(/^\/item\/([A-Za-z0-9]+)\/?$/);
  return url.origin === "https://pay.ldxp.cn" ? match?.[1] ?? null : null;
}

function verifiedLdxpMerchantUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = new URL(value);
  return url.origin === "https://pay.ldxp.cn" &&
      /^\/shop\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
    ? url.toString()
    : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
