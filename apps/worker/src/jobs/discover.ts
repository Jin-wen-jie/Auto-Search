import { describe, expect, it } from "vitest";
import { discoverSource } from "./revalidate.js";

describe("discover job", () => {
  it("returns zero results in placeholder mode (no real connectors)", async () => {
    const result = await discoverSource("src-1", "x", {
      baseUrl: "http://localhost:3001",
      token: "test-token",
      keywords: [],
    });
    expect(result).toMatchObject({ discovered: 0, deduped: 0, error: null });
  });
});
