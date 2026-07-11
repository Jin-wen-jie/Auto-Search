"use client";

import { DataTable } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import { StatusBadge } from "../../../components/status-badge";
import type { Column } from "../../../components/data-table";

interface Merchant {
  id: string; name: string; homepageUrl: string | null;
  platform: string; activeListings: number; note: string;
  lastVerifiedAt: string | null; status: string;
}

// 从公开来源发现的个人店铺（非官方、非聚合站）
const demoMerchants: Merchant[] = [
  { id: "m-1", name: "梦泽小店",        homepageUrl: "https://pay.ldxp.cn/shop/mengze", platform: "X + TG 发现", activeListings: 10, note: "ChatGPT/Claude/Gemini/Perplexity/DeepSeek/Grok 全系代购", lastVerifiedAt: "2026-07-11 10:00", status: "ACTIVE" },
  { id: "m-2", name: "AI便利店 (待核实)",  homepageUrl: null,                            platform: "X 发现",      activeListings: 5,  note: "X 帖子发现的 ChatGPT 账号卖家 — 店铺链接待确认",    lastVerifiedAt: null,               status: "NEEDS_REVIEW" },
  { id: "m-3", name: "TG-Claude车 (待核实)", homepageUrl: null,                         platform: "Telegram 发现", activeListings: 3, note: "TG 频道分享的 Claude 共享车位 — 无公开店铺页",    lastVerifiedAt: null,               status: "NEEDS_REVIEW" },
  { id: "m-4", name: "API代充-老王 (待核实)", homepageUrl: null,                        platform: "Telegram 发现", activeListings: 8, note: "TG 频道宣称可代充 OpenAI/DeepSeek/Mistral API",  lastVerifiedAt: null,               status: "NEEDS_REVIEW" },
  { id: "m-5", name: "Gemini批发 (待核实)",  homepageUrl: null,                         platform: "X 发现",      activeListings: 2,  note: "X 帖子提及的 Gemini Advanced 批发卖家",            lastVerifiedAt: null,               status: "NEEDS_REVIEW" },
];

const cols: Column<Merchant>[] = [
  { key: "name", header: "商家", render: (r) => <span className="font-semibold text-gray-900">{r.name}</span> },
  { key: "note", header: "备注", render: (r) => <span className="text-gray-700 text-xs">{r.note}</span> },
  { key: "homepage", header: "店铺主页", render: (r) => r.homepageUrl ? <ExternalLink href={r.homepageUrl}>打开店铺</ExternalLink> : <span className="text-orange-600 text-xs font-medium">未确认</span> },
  { key: "platform", header: "发现来源", render: (r) => <span className="text-gray-700 text-xs">{r.platform}</span> },
  { key: "listings", header: "商品数", render: (r) => <span className="font-mono font-semibold text-gray-900">{r.activeListings}</span> },
  { key: "verified", header: "最后验证", render: (r) => r.lastVerifiedAt ? <span className="text-gray-600 text-xs">{r.lastVerifiedAt}</span> : <span className="text-orange-500 text-xs">待验证</span> },
  { key: "status", header: "状态", render: (r) => <StatusBadge status={r.status} /> },
];

export default function MerchantsPage() {
  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-gray-900">商家档案</h2>
      <p className="mb-4 text-xs text-gray-500">从 X/TG 公开内容中发现的个人店铺。仅梦泽小店已确认店铺主页，其余商家信息来自公开帖子且待进一步核实。</p>
      <DataTable columns={cols} rows={demoMerchants} getRowKey={(r) => r.id} />
    </div>
  );
}
