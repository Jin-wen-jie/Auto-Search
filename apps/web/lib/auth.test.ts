import { describe, expect, it } from "vitest";
import { assertCsrf, loginPolicy } from "./auth.js";

describe("admin auth", () => {
  it("locks after five failed attempts", () => {
    expect(
      loginPolicy(
        { failedAttempts: 5, lockedUntil: null },
        new Date("2026-07-10T00:00:00Z"),
      ),
    ).toMatchObject({ allowed: false });
  });

  it("rejects mismatched csrf tokens", () => {
    expect(() => assertCsrf("cookie-token", "form-token")).toThrow(
      "CSRF_MISMATCH",
    );
  });
});
