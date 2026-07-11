import { NextResponse } from "next/server";
import { z } from "zod";

const createSchema = z.object({ productUrl: z.string().url() });

// 模拟从 X/TG 公开内容中发现的个人店铺商品链接
// 每条候选都对应一个独立卖家（非官方、非聚合站）
const demoCandidates: Array<{
  id: string; productUrl: string; sourceType: "manual" | "x" | "telegram";
  status: string; title: string | null; price: string | null;
  merchantName: string | null; sourceUrl: string | null; merchantUrl: string | null; createdAt: string;
}> = [
  // ── 从 X 公开帖子发现的个人店铺 ──
  { id: "c-x1", productUrl: "https://pay.ldxp.cn/shop/mengze", sourceType: "x", status: "APPROVED", title: "梦泽小店 — ChatGPT/Claude/Gemini 全系账号", price: "¥15 起", merchantName: "梦泽小店", sourceUrl: "https://x.com/search?q=pay.ldxp.cn%2Fshop%2Fmengze&src=typed_query", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T10:00:00Z" },
  { id: "c-x2", productUrl: "https://pay.ldxp.cn/shop/mengze?product=chatgpt-plus", sourceType: "x", status: "REVIEW_REQUIRED", title: "ChatGPT Plus 共享车位 30天", price: "¥15/月 (三人共享)", merchantName: "梦泽小店", sourceUrl: "https://x.com/someuser/status/1812345678901234567", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T09:30:00Z" },
  { id: "c-x3", productUrl: "https://pay.ldxp.cn/shop/mengze?product=claude-pro", sourceType: "x", status: "REVIEW_REQUIRED", title: "Claude Pro 独享账号 月付", price: "¥25/月 (独享)", merchantName: "梦泽小店", sourceUrl: "https://x.com/someuser/status/1812345678901234568", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T09:00:00Z" },
  { id: "c-x4", productUrl: "https://pay.ldxp.cn/shop/mengze?product=openai-api", sourceType: "x", status: "DISCOVERED", title: "OpenAI API 额度充值 $5 起", price: "$5.00 起", merchantName: "梦泽小店", sourceUrl: "https://x.com/someuser/status/1812345678901234569", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T08:00:00Z" },

  // ── 从 Telegram 公共频道发现的个人店铺 ──
  { id: "c-t1", productUrl: "https://pay.ldxp.cn/shop/mengze?product=gemini-advanced", sourceType: "telegram", status: "REVIEW_REQUIRED", title: "Gemini Advanced 年度订阅代购", price: "¥180/年", merchantName: "梦泽小店", sourceUrl: "https://t.me/ai_shops_channel/123", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T08:30:00Z" },
  { id: "c-t2", productUrl: "https://pay.ldxp.cn/shop/mengze?product=perplexity-pro", sourceType: "telegram", status: "DISCOVERED", title: "Perplexity Pro 1年订阅 代充", price: "¥150/年", merchantName: "梦泽小店", sourceUrl: "https://t.me/ai_shops_channel/124", merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-11T07:30:00Z" },

  // ── 手工补链发现的个人店铺 ──
  { id: "c-m1", productUrl: "https://pay.ldxp.cn/shop/mengze?product=deepseek-topup", sourceType: "manual", status: "VALIDATING", title: null, price: null, merchantName: "梦泽小店", sourceUrl: null, merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-10T22:00:00Z" },
  { id: "c-m2", productUrl: "https://pay.ldxp.cn/shop/mengze?product=grok-premium", sourceType: "manual", status: "DISCOVERED", title: "Grok Premium 月付代购", price: "¥12/月", merchantName: "梦泽小店", sourceUrl: null, merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-10T21:00:00Z" },
  { id: "c-m3", productUrl: "https://pay.ldxp.cn/shop/mengze?product=midjourney", sourceType: "manual", status: "REJECTED", title: "Midjourney 月付 — 已驳回：非 AI 语言模型", price: "$10/月", merchantName: "梦泽小店", sourceUrl: null, merchantUrl: null, createdAt: "2026-07-10T20:00:00Z" },
  { id: "c-m4", productUrl: "https://pay.ldxp.cn/shop/mengze", sourceType: "manual", status: "REVIEW_REQUIRED", title: "梦泽小店店铺首页 — 含 10+ AI 商品", price: "多种", merchantName: "梦泽小店", sourceUrl: null, merchantUrl: "https://pay.ldxp.cn/shop/mengze", createdAt: "2026-07-10T19:00:00Z" },
];

export async function GET() {
  return NextResponse.json(demoCandidates);
}

export async function POST(request: Request) {
  const body = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  const candidate = {
    id: `manual-${Date.now()}`,
    productUrl: body.data.productUrl,
    sourceType: "manual" as const,
    status: "DISCOVERED",
    title: null, price: null, merchantName: null,
    sourceUrl: null, merchantUrl: null,
    createdAt: new Date().toISOString(),
  };
  demoCandidates.push(candidate);
  return NextResponse.json(candidate, { status: 201 });
}
