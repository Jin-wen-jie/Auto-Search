import { describe, expect, it, vi } from "vitest";
import type { BatchResult } from "./run-batch.js";
import {
  parseRunOnceConfig,
  runOnce,
} from "./run-once.js";
import type { WorkerRepositoryRuntime } from "./worker-repository.js";
import {
  DEFAULT_PUBLIC_SEARCH_QUERIES,
  discoverPublicWeb,
} from "./jobs/revalidate.js";

const config = parseRunOnceConfig({
  DATABASE_URL: "postgres://worker-db",
  VALIDATOR_SHARED_TOKEN: "shared-token",
});

const successfulResult: BatchResult = {
  candidates: { attempted: 1, succeeded: 1, failed: 0 },
  listings: { attempted: 0, succeeded: 0, failed: 0 },
  timedOut: false,
};

const emptySearchResult = {
  candidates: [],
  engines: [{
    engine: "bing-rss" as const,
    status: "ACTIVE" as const,
    resultCount: 0,
    errorCategory: null,
  }],
};

function repositoryWithClose(close: () => Promise<void>) {
  return {
    close,
    savePublicSearchRun: vi.fn().mockResolvedValue({ inserted: 0, deduped: 0 }),
  } as unknown as WorkerRepositoryRuntime;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function priceAiPage(offers: unknown[] = []): string {
  const payload = `2d:{"initialData":${JSON.stringify({
    total: offers.length,
    offers,
    limited: false,
  })}}`;
  return `<script>self.__next_f.push(${JSON.stringify([1, payload])})</script>`;
}

describe("runOnce", () => {
  it("awaits repository close after a successful batch", async () => {
    const closing = deferred();
    const close = vi.fn(() => closing.promise);
    const repository = repositoryWithClose(close);
    const invocation = runOnce(config, {
      createRepository: () => repository,
      runBatch: vi.fn().mockResolvedValue(successfulResult),
      discoverPublicWeb: vi.fn().mockResolvedValue(emptySearchResult),
    });
    let settled = false;
    void invocation.then(() => {
      settled = true;
    });

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    closing.resolve();

    await expect(invocation).resolves.toEqual(successfulResult);
  });

  it("awaits repository close before propagating a batch failure", async () => {
    const closing = deferred();
    const close = vi.fn(() => closing.promise);
    const repository = repositoryWithClose(close);
    const failure = new Error("stable batch failure");
    const invocation = runOnce(config, {
      createRepository: () => repository,
      runBatch: vi.fn().mockRejectedValue(failure),
      discoverPublicWeb: vi.fn().mockResolvedValue(emptySearchResult),
    });
    let settled = false;
    void invocation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    closing.resolve();

    await expect(invocation).rejects.toBe(failure);
  });

  it("preserves both batch and close failures", async () => {
    const batchFailure = new Error("stable batch failure");
    const closeFailure = new Error("stable close failure");
    const repository = repositoryWithClose(
      vi.fn().mockRejectedValue(closeFailure),
    );

    const failure = await runOnce(config, {
      createRepository: () => repository,
      runBatch: vi.fn().mockRejectedValue(batchFailure),
      discoverPublicWeb: vi.fn().mockResolvedValue(emptySearchResult),
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message: "WORKER_BATCH_AND_CLOSE_FAILED",
      errors: [batchFailure, closeFailure],
    });
  });

  it("stores public search results before sweeping candidates", async () => {
    const order: string[] = [];
    const repository = repositoryWithClose(vi.fn().mockResolvedValue(undefined));
    vi.mocked(repository.savePublicSearchRun).mockImplementation(async () => {
      order.push("save-search");
      return { inserted: 1, deduped: 0 };
    });
    const runBatch = vi.fn().mockImplementation(async () => {
      order.push("run-batch");
      return successfulResult;
    });

    await runOnce(config, {
      createRepository: () => repository,
      runBatch,
      discoverPublicWeb: vi.fn().mockResolvedValue({
        ...emptySearchResult,
        candidates: [{
          url: "https://shop.example/item/k12",
          title: "K12 account",
          snippet: "商品",
          engine: "bing-rss",
          focus: "K12",
        }],
      }),
    });

    expect(order).toEqual(["save-search", "run-batch"]);
  });
});

describe("public web discovery", () => {
  it("parses Bing RSS and deduplicates relevant public product URLs", async () => {
    const rss = `<?xml version="1.0" encoding="utf-8"?>
      <rss><channel>
        <item><title>GPT Team K12 成品</title><link>https://pay.ldxp.cn/item/abc123?utm_source=bing</link><description>K12 商品库存</description></item>
        <item><title>Bug Team account</title><link>https://shop.example/products/bug-team</link><description>Bug Team 账号商品</description></item>
        <item><title>K12 school login</title><link>https://school.example/login</link><description>K12 account portal</description></item>
        <item><title>普通新闻</title><link>https://news.example/story</link><description>无关内容</description></item>
      </channel></rss>`;
    const request = async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      return url.hostname === "priceai.cc"
        ? new Response(priceAiPage())
        : new Response(rss, {
          status: 200,
          headers: { "content-type": "application/rss+xml" },
        });
    };

    const result = await discoverPublicWeb(
      { maxResults: 50 },
      request as typeof fetch,
    );

    expect(DEFAULT_PUBLIC_SEARCH_QUERIES).toHaveLength(4);
    expect(result.engines).toEqual([
      {
        engine: "priceai",
        status: "ACTIVE",
        resultCount: 0,
        errorCategory: null,
      },
      {
        engine: "bing-rss",
        status: "ACTIVE",
        resultCount: 16,
        errorCategory: null,
      },
    ]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        url: "https://pay.ldxp.cn/item/abc123",
        engine: "bing-rss",
        focus: "K12",
      }),
      expect.objectContaining({
        url: "https://shop.example/products/bug-team",
        engine: "bing-rss",
        focus: "Bug Team",
      }),
    ]);
  });

  it("collects PriceAI leads with source metadata for direct validation", async () => {
    const requestedOffsets: string[] = [];
    const request = async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.hostname === "priceai.cc") {
        if (url.pathname.startsWith("/api/")) {
          const offset = url.searchParams.get("offset") ?? "0";
          requestedOffsets.push(offset);
          return Response.json({
            total: 201,
            limited: true,
            offers: offset === "0"
              ? [
                {
                  url: "https://pay.ldxp.cn/item/new-k12",
                  sourceTitle: "K12 Team 成品",
                  sourceStoreName: "公开商铺",
                  price: 0.88,
                  currency: "CNY",
                  status: "in_stock",
                  stockCount: 18,
                  filterTags: ["team_k12", "proxy_supported"],
                  verifiedAt: "2026-07-15T09:00:00.000Z",
                  hidden: false,
                },
                {
                  url: "https://pay.ldxp.cn/item/high-k12",
                  sourceTitle: "High K12 Team account",
                  price: 1.21,
                  status: "in_stock",
                  stockCount: 10,
                  filterTags: ["team_k12"],
                },
                {
                  url: "https://pay.ldxp.cn/item/sold-out-k12",
                  sourceTitle: "Sold out K12 Team account",
                  price: 0.5,
                  status: "out_of_stock",
                  stockCount: 0,
                  filterTags: ["team_k12"],
                },
              ]
              : [{
                url: "https://pay.ldxp.cn/item/new-bug-team",
                sourceTitle: "Bug Team account",
                price: 8,
                status: "in_stock",
                stockCount: 2,
                filterTags: ["team_bug"],
              }],
          });
        }
        return new Response(priceAiPage());
      }
      return new Response(
        "<rss><channel><title>empty</title></channel></rss>",
        { status: 200 },
      );
    };

    const result = await discoverPublicWeb(
      { maxResults: 50 },
      request as typeof fetch,
    );

    expect(requestedOffsets).toEqual(["0", "200"]);
    expect(result.candidates).toEqual([
      expect.objectContaining({
        url: "https://pay.ldxp.cn/item/new-k12",
        engine: "priceai",
        focus: "K12",
        sourceUrl: "https://priceai.cc/products/chatgpt-team-business",
        metadata: expect.objectContaining({
          price: 0.88,
          inventory: 18,
          merchantName: "公开商铺",
          availability: "IN_STOCK",
          observedAt: "2026-07-15T09:00:00.000Z",
        }),
      }),
      expect.objectContaining({
        url: "https://pay.ldxp.cn/item/new-bug-team",
        engine: "priceai",
        focus: "Bug Team",
      }),
    ]);
    expect(result.engines[0]).toEqual({
      engine: "priceai",
      status: "ACTIVE",
      resultCount: 2,
      errorCategory: null,
    });
  });

  it("isolates optional search engine failures", async () => {
    const request = async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.hostname === "priceai.cc") {
        return new Response(priceAiPage());
      }
      if (url.hostname === "www.bing.com") {
        return new Response(
          "<rss><channel><title>empty</title></channel></rss>",
          { status: 200 },
        );
      }
      if (url.hostname === "api.search.brave.com") {
        return new Response("", { status: 429 });
      }
      if (url.hostname === "www.googleapis.com") {
        return Response.json({
          items: [{
            link: "https://store.example/item/k12",
            title: "K12 account 商品",
            snippet: "公开商店",
          }],
        });
      }
      return new Response("", { status: 401 });
    };

    const result = await discoverPublicWeb(
      {
        braveApiKey: "brave-secret",
        googleApiKey: "google-secret",
        googleCx: "search-engine-id",
        serperApiKey: "serper-secret",
        maxResults: 50,
      },
      request as typeof fetch,
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.engines).toEqual([
      expect.objectContaining({ engine: "priceai", status: "ACTIVE" }),
      expect.objectContaining({ engine: "bing-rss", status: "ACTIVE" }),
      expect.objectContaining({ engine: "brave", status: "RATE_LIMITED" }),
      expect.objectContaining({ engine: "google", status: "ACTIVE" }),
      expect.objectContaining({ engine: "serper", status: "AUTH_DISABLED" }),
    ]);
  });
});
