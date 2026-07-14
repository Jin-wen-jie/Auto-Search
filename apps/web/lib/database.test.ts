import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDb: vi.fn(() => ({ kind: "db" })),
}));

vi.mock("@compare/db", () => ({
  createDb: mocks.createDb,
}));

const originalDatabaseUrl = process.env.DATABASE_URL;

async function getDatabaseForUrl(databaseUrl: string) {
  vi.resetModules();
  process.env.DATABASE_URL = databaseUrl;
  const { getDatabase } = await import("./database.js");
  return getDatabase();
}

describe("web database configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it("retires idle direct database sessions", async () => {
    await getDatabaseForUrl("postgres://db.example.supabase.co/postgres");

    expect(mocks.createDb).toHaveBeenCalledWith(
      "postgres://db.example.supabase.co/postgres",
      { maxConnections: 1, idleTimeoutSeconds: 20 },
    );
  });

  it("keeps transaction-pooler sessions available for warm requests", async () => {
    await getDatabaseForUrl("postgres://user:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres");

    expect(mocks.createDb).toHaveBeenCalledWith(
      "postgres://user:pass@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres",
      { maxConnections: 1 },
    );
  });

  it("allows bounded concurrency for the local development database", async () => {
    await getDatabaseForUrl("postgres://postgres:pass@localhost:5432/compare");

    expect(mocks.createDb).toHaveBeenCalledWith(
      "postgres://postgres:pass@localhost:5432/compare",
      { maxConnections: 4, idleTimeoutSeconds: 20 },
    );
  });
});
