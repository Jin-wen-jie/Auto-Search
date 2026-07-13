import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDb } from "./client.js";

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: vi.fn(() => ({ kind: "db" })),
}));

vi.mock("postgres", () => ({
  default: vi.fn(() => ({ kind: "client" })),
}));

describe("database client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets bounded connection and PostgreSQL session timeouts", () => {
    const database = createDb("postgres://session-pooler/compare");

    expect(postgres).toHaveBeenCalledWith(
      "postgres://session-pooler/compare",
      {
        max: 10,
        connect_timeout: 10,
        prepare: true,
        connection: {
          statement_timeout: 30_000,
          lock_timeout: 5_000,
          idle_in_transaction_session_timeout: 30_000,
        },
      },
    );
    expect(drizzle).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "client" }),
      expect.objectContaining({ schema: expect.any(Object) }),
    );
    expect(database).toEqual({ kind: "db" });
  });

  it("allows serverless callers to limit and retire idle connections", () => {
    createDb("postgres://session-pooler/compare", {
      maxConnections: 1,
      idleTimeoutSeconds: 20,
    });

    expect(postgres).toHaveBeenCalledWith(
      "postgres://session-pooler/compare",
      expect.objectContaining({ max: 1, idle_timeout: 20 }),
    );
  });
});
