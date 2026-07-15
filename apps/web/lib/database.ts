import { createDb, type Db } from "@compare/db";

let database: Db | undefined;

export function getDatabase(): Db {
  if (database) return database;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const connectionUrl = transactionPoolerUrl(databaseUrl);
  database = createDb(connectionUrl, {
    maxConnections: usesLocalDatabase(databaseUrl) ? 4 : 1,
    idleTimeoutSeconds: usesSupabasePooler(databaseUrl) ? 5 : 20,
  });
  return database;
}

export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientDatabaseError(error) || attempt === attempts) throw error;
      const delay = Math.min(4_000, 500 * (2 ** (attempt - 1)));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function transactionPoolerUrl(databaseUrl: string): string {
  if (!usesSupabasePooler(databaseUrl)) return databaseUrl;
  const url = new URL(databaseUrl);
  if (url.port === "6543") return databaseUrl;
  url.port = "6543";
  return url.toString();
}

function isTransientDatabaseError(error: unknown): boolean {
  const category = databaseFailureCategory(error);
  return category === "DB_POOL_EXHAUSTED" ||
    category === "DB_CONNECTION_FAILED";
}

export function databaseFailureCategory(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      break;
    }
  }
  const message = messages.join(" ");
  if (/EMAXCONNSESSION|max clients reached/i.test(message)) {
    return "DB_POOL_EXHAUSTED";
  }
  if (/tenant or user not found|invalid tenant/i.test(message)) {
    return "DB_POOLER_CONFIGURATION";
  }
  if (/password authentication failed|authentication failed/i.test(message)) {
    return "DB_AUTH_FAILED";
  }
  if (/ECONNRESET|ETIMEDOUT|CONNECT_TIMEOUT|connection terminated|ENOTFOUND/i.test(message)) {
    return "DB_CONNECTION_FAILED";
  }
  return "DB_QUERY_FAILED";
}

function usesSupabasePooler(databaseUrl: string): boolean {
  return new URL(databaseUrl).hostname.endsWith(".pooler.supabase.com");
}

function usesLocalDatabase(databaseUrl: string): boolean {
  const hostname = new URL(databaseUrl).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
