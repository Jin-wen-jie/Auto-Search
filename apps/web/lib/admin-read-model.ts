export interface RankingViewInput {
  id: string;
  provider: string;
  productLine: string;
  plan: string;
  delivery: string;
  merchantName: string;
  merchantUrl: string | null;
  originalUrl: string;
  sourceUrl: string | null;
  originalPrice: string | null;
  currency: string | null;
  convertedPriceCny: string | null;
  bundleQty: number;
  minBundleCount: number;
  stockEvidence: unknown;
  lastVerifiedAt: Date;
}

export interface RankingView {
  id: string;
  spec: string;
  merchant: string;
  price: string;
  totalCny: string;
  unitCny: string;
  supplyEvidence: string;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "UNKNOWN";
  confidence: number | null;
  lastVerified: string;
  productUrl: string;
  sourceUrl: string | null;
  merchantUrl: string | null;
}

export interface ApprovedCandidateRankingInput {
  id: string;
  productUrl: string;
  extractionResult: unknown;
  eventSourceUrl: string | null;
  createdAt: Date;
}

export function toApprovedCandidateRankingView(
  input: ApprovedCandidateRankingInput,
): RankingView {
  const extraction = isRecord(input.extractionResult)
    ? input.extractionResult
    : {};
  const price = numericValue(extraction.price);
  const totalPrice = numericValue(extraction.totalPrice) ?? price;
  const merchantName = stringValue(extraction.merchantName) ?? "未识别商家";
  const merchantUrl = stringValue(extraction.merchantUrl);
  const sourceUrl =
    stringValue(extraction.sourceUrl) ?? input.eventSourceUrl;
  const focus = stringValue(extraction.focus) ?? "未分类";
  const availability = normalizeAvailability(extraction.availability);
  const inventory = numberValue(extraction.inventory);
  const observedAt = validDate(extraction.observedAt) ?? input.createdAt;
  const evidenceParts = [availabilityLabel(availability)];
  if (inventory !== null) evidenceParts.push(`库存 ${inventory}`);

  return {
    id: input.id,
    spec: focus,
    merchant: merchantName,
    price: price === null ? "—" : `CNY ${price.toFixed(2)}`,
    totalCny: totalPrice === null ? "—" : `¥${totalPrice.toFixed(2)}`,
    unitCny: totalPrice === null ? "—" : `¥${totalPrice.toFixed(2)}/件`,
    supplyEvidence: evidenceParts.filter(Boolean).join(" · ") || "暂无库存证据",
    availability,
    confidence: null,
    lastVerified: observedAt.toISOString(),
    productUrl: input.productUrl,
    sourceUrl,
    merchantUrl,
  };
}

export function toRankingView(input: RankingViewInput): RankingView {
  const total = input.convertedPriceCny === null
    ? null
    : Number(input.convertedPriceCny);
  const unitCount = Math.max(1, input.bundleQty * input.minBundleCount);
  const evidence = isRecord(input.stockEvidence) ? input.stockEvidence : {};
  const availability = normalizeAvailability(evidence.availability);
  const stockQuantity = numberValue(evidence.stockQuantity);
  const confidenceValue = numberValue(evidence.confidence);
  const evidenceParts = [availabilityLabel(availability)];
  if (stockQuantity !== null) evidenceParts.push(`库存 ${stockQuantity}`);

  return {
    id: input.id,
    spec: [input.provider, input.productLine, input.plan, input.delivery].join(
      " | ",
    ),
    merchant: input.merchantName,
    price:
      input.originalPrice && input.currency
        ? `${input.currency} ${input.originalPrice}`
        : "—",
    totalCny:
      total !== null && Number.isFinite(total) ? `¥${total.toFixed(2)}` : "—",
    unitCny:
      total !== null && Number.isFinite(total)
        ? `¥${(total / unitCount).toFixed(2)}/份`
        : "—",
    supplyEvidence: evidenceParts.filter(Boolean).join(" · ") || "无库存证据",
    availability,
    confidence:
      confidenceValue === null
        ? null
        : Math.round(
            confidenceValue <= 1 ? confidenceValue * 100 : confidenceValue,
          ),
    lastVerified: input.lastVerifiedAt.toISOString(),
    productUrl: input.originalUrl,
    sourceUrl: input.sourceUrl,
    merchantUrl: input.merchantUrl,
  };
}

function normalizeAvailability(
  value: unknown,
): RankingView["availability"] {
  if (value === "IN_STOCK") return "IN_STOCK";
  if (value === "OUT_OF_STOCK" || value === "UNAVAILABLE") {
    return "OUT_OF_STOCK";
  }
  return "UNKNOWN";
}

function availabilityLabel(value: RankingView["availability"]): string {
  if (value === "IN_STOCK") return "有货";
  if (value === "OUT_OF_STOCK") return "无货";
  return "待核验";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
