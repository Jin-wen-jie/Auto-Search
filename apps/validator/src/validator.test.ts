import { describe, expect, it, vi } from "vitest";
import { PublicUrlError } from "./safe-url.js";
import { assertPublicUrl } from "./safe-url.js";
import { extractProduct } from "./extract-product.js";
import { createPinnedLookup, fetchPage } from "./fetch-page.js";

describe("validator", () => {
  it("blocks private destinations", async () => {
    await expect(
      assertPublicUrl("http://example.test/product", async () => [
        "127.0.0.1",
      ]),
    ).rejects.toThrow(PublicUrlError);
  });

  it.each([
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::]/",
    "http://[2001::1]/",
    "http://[2002:7f00:1::]/",
    "http://[64:ff9b::7f00:1]/",
  ])("blocks IPv4 and IPv6 special destination %s", async (url) => {
    await expect(assertPublicUrl(url)).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS",
    });
  });

  it("rejects the entire DNS result when any IPv6 address is private", async () => {
    await expect(
      assertPublicUrl("https://shop.example/product", async () => [
        "2606:4700:4700::1111",
        "::1",
      ]),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS" });
  });

  it("returns every validated address for connection pinning", async () => {
    await expect(
      assertPublicUrl("https://shop.example/product", async () => [
        "93.184.216.34",
        "2606:4700:4700::1111",
      ]),
    ).resolves.toMatchObject({
      hostname: "shop.example",
      addresses: [
        { address: "93.184.216.34", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
    });
  });

  it("pins the transport lookup to validated addresses", async () => {
    const lookup = createPinnedLookup([
      { address: "93.184.216.34", family: 4 },
    ]);

    await expect(
      new Promise<{ address: string; family: number }>((resolve, reject) => {
        lookup("attacker.example", { family: 0 }, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address: address as string, family: family as number });
        });
      }),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("revalidates and pins every redirect hop", async () => {
    const resolveUrl = vi
      .fn()
      .mockResolvedValueOnce({
        hostname: "first.example",
        addresses: [{ address: "93.184.216.34", family: 4 }],
      })
      .mockResolvedValueOnce({
        hostname: "second.example",
        addresses: [{ address: "203.0.113.10", family: 4 }],
      });
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://second.example/product" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html><title>Product</title></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    await expect(
      fetchPage("https://first.example/product", { resolveUrl, request }),
    ).resolves.toMatchObject({
      finalUrl: "https://second.example/product",
      redirectChain: ["https://first.example/product"],
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://first.example/product",
      [{ address: "93.184.216.34", family: 4 }],
      expect.any(AbortSignal),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://second.example/product",
      [{ address: "203.0.113.10", family: 4 }],
      expect.any(AbortSignal),
    );
  });

  it("extracts a normal public product", () => {
    const html =
      '<script type="application/ld+json">{"@type":"Product","name":"K12 ChatGPT Education","offers":{"@type":"Offer","price":"19.99","priceCurrency":"USD","availability":"https://schema.org/InStock"}}</script>';
    expect(
      extractProduct(html, "https://shop.example/product"),
    ).toMatchObject({
      title: "K12 ChatGPT Education",
      price: "19.99",
      currency: "USD",
      availability: "IN_STOCK",
    });
  });
});
