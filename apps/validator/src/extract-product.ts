import * as cheerio from "cheerio";

export interface ExtractedProduct {
  title: string | null;
  price: string | null;
  currency: string | null;
  availability: "IN_STOCK" | "OUT_OF_STOCK" | "PREORDER" | "UNKNOWN";
  stockText: string | null;
  stockQuantity: number | null;
  buyAction: boolean;
  pageFingerprint: string;
  confidence: {
    title: number;
    price: number;
    availability: number;
  };
}

/**
 * Extract product information from HTML.
 * Priority: JSON-LD > OpenGraph > visible DOM.
 */
export function extractProduct(
  html: string,
  pageUrl: string,
): ExtractedProduct {
  const $ = cheerio.load(html);

  // 1. Try JSON-LD
  const jsonLd = tryJsonLd($);
  if (jsonLd) {
    return jsonLd;
  }

  // 2. Try OpenGraph
  const og = tryOpenGraph($);
  if (og.title || og.price) {
    return og;
  }

  // 3. Fallback to visible DOM
  return tryDom($, pageUrl);
}

function tryJsonLd($: cheerio.CheerioAPI): ExtractedProduct | null {
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

function tryOpenGraph($: cheerio.CheerioAPI): ExtractedProduct {
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
): ExtractedProduct {
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
): ExtractedProduct {
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

function hashString(s: string): string {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}
