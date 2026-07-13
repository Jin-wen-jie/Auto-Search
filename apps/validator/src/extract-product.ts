import * as cheerio from "cheerio";

/**
 * 已知的发卡平台域名列表。
 * 当抓取这些域名下的页面时，会额外提取同平台其他店铺链接。
 */
const KNOWN_PLATFORMS: string[] = [
  "ldxp.cn",
  "codesky.qzz.io",
  "gptmf.com",
];

export interface ExtractedProduct {
  title: string | null;
  price: string | null;
  currency: string | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN";
  stockText: string | null;
  stockQuantity: number | null;
  buyAction: boolean;
  pageFingerprint: string;
  /** 同平台发现的其它店铺链接（去重后） */
  platformLinks: string[];
  confidence: {
    title: number;
    price: number;
    availability: number;
  };
}

type ExtractedProductDetails = Omit<ExtractedProduct, "platformLinks">;

/**
 * Extract product information from HTML.
 * Priority: JSON-LD > OpenGraph > visible DOM.
 */
export function extractProduct(
  html: string,
  pageUrl: string,
): ExtractedProduct {
  const $ = cheerio.load(html);

  // Extract platform links from page (known card platforms)
  const platformLinks = extractPlatformLinks($, pageUrl);

  // 1. Try JSON-LD
  const jsonLd = tryJsonLd($);
  if (jsonLd) {
    return { ...jsonLd, platformLinks };
  }

  // 2. Try OpenGraph
  const og = tryOpenGraph($);
  if (og.title || og.price) {
    return { ...og, platformLinks };
  }

  // 3. Fallback to visible DOM
  return { ...tryDom($, pageUrl), platformLinks };
}

function tryJsonLd($: cheerio.CheerioAPI): ExtractedProductDetails | null {
  const scripts = $('script[type="application/ld+json"]');
  for (const el of scripts) {
    try {
      const data = JSON.parse($(el).html() ?? "{}");
      if (data["@type"] === "Product" || data["@graph"]) {
        const product =
          data["@type"] === "Product"
            ? data
            : (data["@graph"] as unknown[]).find(
                (i: unknown) =>
                  (i as Record<string, unknown>)["@type"] === "Product",
              );

        if (!product) continue;

        const offer = (product as Record<string, unknown>)
          .offers as Record<string, unknown> | null;

        const title = (product as Record<string, unknown>).name as
          | string
          | null;

        const price = offer?.price as string | null;
        const currency = offer?.priceCurrency as string | null;
        const availability = mapAvailability(
          (offer?.availability as string) ?? "",
        );

        return buildResult($, title, price, currency, availability, 0.9);
      }
    } catch {
      // JSON parse failed, try next script
    }
  }
  return null;
}

function tryOpenGraph($: cheerio.CheerioAPI): ExtractedProductDetails {
  const title =
    $('meta[property="og:title"]').attr("content") ?? null;
  const price =
    $('meta[property="product:price:amount"]').attr("content") ?? null;
  const currency =
    $('meta[property="product:price:currency"]').attr("content") ??
    null;

  return buildResult($, title, price, currency, "UNKNOWN", 0.6);
}

function tryDom(
  $: cheerio.CheerioAPI,
  _pageUrl: string,
): ExtractedProductDetails {
  const title = $("h1").first().text().trim() || $("title").text().trim() ||
    null;

  // Look for price patterns
  const body = $("body").text();
  const priceMatch = body.match(
    /(?:¥|￥|USD|EUR|GBP)\s*([\d,]+\.?\d*)/i,
  );
  const price = priceMatch?.[1]?.replace(/,/g, "") ?? null;

  const buyButton =
    $(
      'button:contains("Buy"), button:contains("购买"), button:contains("Add to Cart"), a:contains("Buy"), a:contains("购买")',
    ).length > 0;

  return buildResult($, title, price, null, "UNKNOWN", 0.3, buyButton);
}

function mapAvailability(
  schemaValue: string,
): "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN" {
  const lower = schemaValue.toLowerCase();
  if (lower.includes("instock")) return "IN_STOCK";
  if (lower.includes("outofstock") || lower.includes("soldout")) {
    return "OUT_OF_STOCK";
  }
  if (lower.includes("preorder")) return "PREORDER";
  return "UNKNOWN";
}

function buildResult(
  $: cheerio.CheerioAPI,
  title: string | null,
  price: string | null,
  currency: string | null,
  availability: ExtractedProduct["availability"],
  baseConfidence: number,
  buyAction?: boolean,
): ExtractedProductDetails {
  const buyActionResolved =
    buyAction ??
    ($('a[href*="cart"], a[href*="checkout"], button').length > 0);

  // Detect stock text
  const bodyText = $("body").text().toLowerCase();
  const stockText = bodyText.includes("in stock") ||
      bodyText.includes("有货") ||
      bodyText.includes("现货")
    ? "有货"
    : bodyText.includes("out of stock") ||
        bodyText.includes("缺货") ||
        bodyText.includes("sold out")
    ? "缺货"
    : null;

  // Stock quantity from page
  const qtyMatch = bodyText.match(
    /(\d+)\s*(?:in stock|available|有货|库存|剩余)/i,
  );
  const stockQuantity = qtyMatch ? Number.parseInt(qtyMatch[1]!, 10) : null;

  const pageFingerprint = hashString(
    title ?? "" + ($("h1").text() || $("title").text()),
  );

  return {
    title,
    price,
    currency,
    availability,
    stockText,
    stockQuantity,
    buyAction: buyActionResolved,
    pageFingerprint,
    confidence: {
      title: title ? baseConfidence : 0.1,
      price: price ? baseConfidence : 0.1,
      availability:
        availability !== "UNKNOWN" ? baseConfidence : 0.1,
    },
  };
}

/**
 * 从页面中提取同平台其它店铺的链接。
 * 只提取已知发卡平台域名下的相关路径链接（自动去重）。
 * 不同平台的店铺页路径模式：
 *   - ldxp.cn → /shop/{shopName}
 *   - codesky.qzz.io → /item/{id}
 *   - gptmf.com → /buy/{id}
 */
function extractPlatformLinks(
  $: cheerio.CheerioAPI,
  pageUrl: string,
): string[] {
  const seen = new Set<string>();
  const links: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, pageUrl);

      // 只关注已知平台域名
      if (!KNOWN_PLATFORMS.some((platform) =>
        resolved.hostname === platform ||
        resolved.hostname.endsWith(`.${platform}`)
      )) return;

      // 关注店铺或商品页路径（不同平台模式不同）
      const isShopPage =
        resolved.pathname.startsWith("/shop/") ||
        resolved.pathname.startsWith("/item/") ||
        resolved.pathname.startsWith("/buy/");

      if (!isShopPage) return;

      // 去掉 fragment 后的规范化 URL
      resolved.hash = "";
      const canonical = resolved.toString();

      // 跳过当前页面自身
      if (canonical === new URL(pageUrl).href) return;

      if (!seen.has(canonical)) {
        seen.add(canonical);
        links.push(canonical);
      }
    } catch {
      // 忽略无法解析的链接
    }
  });

  return links;
}

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
