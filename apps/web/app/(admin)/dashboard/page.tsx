"use client";

import { useState } from "react";
import { DataTable } from "../../../components/data-table";
import { ExternalLink } from "../../../components/external-link";
import type { Column } from "../../../components/data-table";

interface RankingRow {
  id: string; spec: string; merchant: string; price: string; totalCny: string;
  unitCny: string; supplyScore: string; supplyEvidence: string; confidence: number;
  lastVerified: string; productUrl: string; sourceUrl?: string; merchantUrl?: string;
}

// 模拟从公开内容发现的个人店铺 AI 商品
const demoRankings: RankingRow[] = [
  { id: "1", spec: "ChatGPT | Plus | 账号 | 共享 | 30天", merchant: "梦泽小店", price: "¥15/月", totalCny: "¥15.00", unitCny: "¥15.00/月", supplyScore: "65.0", supplyEvidence: "页面有货 | 明确标价", confidence: 68, lastVerified: "刚刚", productUrl: "https://pay.ldxp.cn/shop/mengze?product=chatgpt-plus", sourceUrl: "https://x.com/search?q=pay.ldxp.cn/shop/mengze", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "2", spec: "Claude | Pro | 账号 | 独享 | 月付", merchant: "梦泽小店", price: "¥25/月", totalCny: "¥25.00", unitCny: "¥25.00/月", supplyScore: "62.0", supplyEvidence: "页面有货 | 明确标价", confidence: 65, lastVerified: "刚刚", productUrl: "https://pay.ldxp.cn/shop/mengze?product=claude-pro", sourceUrl: "https://x.com/search?q=pay.ldxp.cn/shop/mengze", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "3", spec: "ChatGPT | Plus | 账号 | 独享 | 月付", merchant: "梦泽小店", price: "¥40/月", totalCny: "¥40.00", unitCny: "¥40.00/月", supplyScore: "60.0", supplyEvidence: "页面有货 | 明确标价", confidence: 62, lastVerified: "刚刚", productUrl: "https://pay.ldxp.cn/shop/mengze?product=chatgpt-plus-premium", sourceUrl: "https://t.me/ai_shops_channel/125", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "4", spec: "Gemini | Advanced | 账号 | 独享 | 年付", merchant: "梦泽小店", price: "¥180/年", totalCny: "¥180.00", unitCny: "¥15.00/月", supplyScore: "58.0", supplyEvidence: "页面有货 | 明确标价", confidence: 60, lastVerified: "1 小时前", productUrl: "https://pay.ldxp.cn/shop/mengze?product=gemini-advanced", sourceUrl: "https://t.me/ai_shops_channel/123", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "5", spec: "Perplexity | Pro | 账号 | 独享 | 年付", merchant: "梦泽小店", price: "¥150/年", totalCny: "¥150.00", unitCny: "¥12.50/月", supplyScore: "55.0", supplyEvidence: "页面有货 | 明确标价", confidence: 58, lastVerified: "1 小时前", productUrl: "https://pay.ldxp.cn/shop/mengze?product=perplexity-pro", sourceUrl: "https://t.me/ai_shops_channel/124", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "6", spec: "OpenAI | API | 额度 | 按量 | $5起", merchant: "梦泽小店", price: "$5.00 起", totalCny: "¥36.25", unitCny: "¥36.25/次", supplyScore: "50.0", supplyEvidence: "购买按钮可用", confidence: 45, lastVerified: "2 小时前", productUrl: "https://pay.ldxp.cn/shop/mengze?product=openai-api", sourceUrl: "https://x.com/search?q=pay.ldxp.cn/shop/mengze", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "7", spec: "Grok | Premium | 账号 | 共享 | 月付", merchant: "梦泽小店", price: "¥12/月", totalCny: "¥12.00", unitCny: "¥12.00/月", supplyScore: "42.0", supplyEvidence: "来源帖宣称有货 | 待验证", confidence: 32, lastVerified: "3 小时前", productUrl: "https://pay.ldxp.cn/shop/mengze?product=grok-premium", sourceUrl: "https://x.com/search?q=grok+premium+代购", merchantUrl: "https://pay.ldxp.cn/shop/mengze" },
  { id: "8", spec: "DeepSeek | 代充 | 额度 | 按量", merchant: "梦泽小店", price: "¥0.001/1K tokens", totalCny: "¥0.001", unitCny: "¥0.001/1K", supplyScore: "30.0", supplyEvidence: "来源帖宣称 | 待验证页面", confidence: 18, lastVerified: "5 小时前", productUrl: "https://pay.ldxp.cn/shop/mengze?product=deepseek-topup", sourceUrl: "https://t.me/ai_shops_channel/126" },
];

const priceColumns: Column<RankingRow>[] = [
  { key: "unitCny", header: "有效单位价", render: (r) => <span className="font-mono font-bold text-green-700 text-base">{r.unitCny}</span> },
  { key: "spec", header: "规格", render: (r) => <span className="text-gray-800 text-xs">{r.spec}</span> },
  { key: "merchant", header: "商家", render: (r) => <span className="font-semibold text-gray-900">{r.merchant}</span> },
  { key: "price", header: "原价", render: (r) => <span className="font-mono text-gray-700 text-xs">{r.price}</span> },
  { key: "totalCny", header: "总支出", render: (r) => <span className="font-mono text-gray-900 font-semibold text-xs">{r.totalCny}</span> },
  { key: "product", header: "商品页", render: (r) => <ExternalLink href={r.productUrl}>打开</ExternalLink> },
  { key: "source", header: "发现帖", render: (r) => r.sourceUrl ? <ExternalLink href={r.sourceUrl}>来源</ExternalLink> : <span className="text-gray-500 text-xs">手工</span> },
  { key: "verified", header: "验证", render: (r) => <span className="text-gray-600 text-xs">{r.lastVerified}</span> },
];

const supplyColumns: Column<RankingRow>[] = [
  { key: "supplyScore", header: "货源分", render: (r) => <span className="font-mono font-bold text-blue-700 text-base">{r.supplyScore}</span> },
  { key: "evidence", header: "货源证据", render: (r) => <span className="text-gray-800 text-xs">{r.supplyEvidence}{r.confidence < 80 && <span className="ml-1 rounded bg-orange-100 px-1 py-0.5 text-xs font-semibold text-orange-700">估算 {r.confidence}%</span>}</span> },
  { key: "spec", header: "规格", render: (r) => <span className="text-gray-800 text-xs">{r.spec}</span> },
  { key: "merchant", header: "商家", render: (r) => <span className="font-semibold text-gray-900">{r.merchant}</span> },
  { key: "product", header: "商品页", render: (r) => <ExternalLink href={r.productUrl}>打开</ExternalLink> },
  { key: "source", header: "发现帖", render: (r) => r.sourceUrl ? <ExternalLink href={r.sourceUrl}>来源</ExternalLink> : <span className="text-gray-500 text-xs">手工</span> },
  { key: "merchantLink", header: "店铺", render: (r) => r.merchantUrl ? <ExternalLink href={r.merchantUrl}>店铺</ExternalLink> : <span className="text-gray-400">—</span> },
  { key: "verified", header: "验证", render: (r) => <span className="text-gray-600 text-xs">{r.lastVerified}</span> },
];

export default function DashboardPage() {
  const [tab, setTab] = useState<"price" | "supply">("price");
  return (
    <div>
      <h2 className="mb-1 text-xl font-bold text-gray-900">AI 商品比价总览</h2>
      <p className="mb-4 text-xs text-gray-500">以下数据来自 X/TG 公开内容发现的个人店铺，非官方直营。点击链接可打开实际商品页核实。</p>
      <div className="mb-4 flex gap-2 border-b">
        <button onClick={() => setTab("price")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === "price" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}>价格榜</button>
        <button onClick={() => setTab("supply")} className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === "supply" ? "border-blue-600 text-blue-700" : "border-transparent text-gray-600 hover:text-gray-900"}`}>货源榜</button>
      </div>
      <DataTable columns={tab === "price" ? priceColumns : supplyColumns} rows={demoRankings} getRowKey={(r) => r.id} />
    </div>
  );
}
