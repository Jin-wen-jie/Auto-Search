"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { DataTable } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import { StatusBadge } from "../../../components/status-badge";
import SpecNormalizer from "../../../components/spec-normalizer";
import type { Column } from "../../../components/data-table";

interface Candidate {
  id: string; productUrl: string; sourceType: "manual" | "x" | "telegram";
  status: string; title: string | null; price: string | null;
  merchantName: string | null; sourceUrl: string | null; merchantUrl: string;
  focus: string | null; availability: string | null; evidenceNote: string | null;
  observedAt: string | null; sold: number | null; inventory: number | null;
  canApprove: boolean; createdAt: string;
}

interface CandidatePage {
  items: Candidate[];
  page: number;
  pageSize: number;
  total: number;
}

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
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [normalizingCandidate, setNormalizingCandidate] = useState<Candidate | null>(null);

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
    if (reviewingId) return;
    const previousStatus = candidates.find((candidate) => candidate.id === id)?.status;
    if (!previousStatus) return;
    const optimisticStatus = action === "approve" ? "APPROVED" : "REJECTED";

    setError("");
    setReviewingId(id);
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.id === id
          ? { ...candidate, status: optimisticStatus }
          : candidate,
      ),
    );

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
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? { ...candidate, status: result.status ?? optimisticStatus }
            : candidate,
        ),
      );
    } catch (cause) {
      setCandidates((current) =>
        current.map((candidate) =>
          candidate.id === id
            ? { ...candidate, status: previousStatus }
            : candidate,
        ),
      );
      setError(cause instanceof Error ? cause.message : "审核失败");
    } finally {
      setReviewingId(null);
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
    { key: "actions", header: "操作", render: (r) => reviewingId === r.id ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600"><LoaderCircle className="h-4 w-4 animate-spin" />保存中</span> : (r.status === "REVIEW_REQUIRED" || r.status === "DISCOVERED") ? <div className="flex gap-1.5">{!r.canApprove && <button onClick={() => setNormalizingCandidate(r)} disabled={reviewingId !== null} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40">规格归一化</button>}<button onClick={() => handleReview(r.id, "approve")} disabled={!r.canApprove || reviewingId !== null} title={r.canApprove ? "通过审核" : "需先完成规格归一化"} className="rounded bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300">通过</button><button onClick={() => handleReview(r.id, "reject")} disabled={reviewingId !== null} className="rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40">驳回</button></div> : null },
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
      {normalizingCandidate && (
        <SpecNormalizer
          candidate={normalizingCandidate}
          onClose={() => setNormalizingCandidate(null)}
          onNormalized={() => {
            setNormalizingCandidate(null);
            fetchCandidates();
          }}
        />
      )}
    </div>
  );
}
