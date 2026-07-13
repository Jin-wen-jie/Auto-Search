import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

type CreateDbOptions = {
  maxConnections?: number;
  idleTimeoutSeconds?: number;
};

export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 10,
    ...(options.idleTimeoutSeconds === undefined
      ? {}
      : { idle_timeout: options.idleTimeoutSeconds }),
    connect_timeout: 10,
    prepare: true,
    connection: {
      statement_timeout: 30_000,
      lock_timeout: 5_000,
      idle_in_transaction_session_timeout: 30_000,
    },
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
export type Transaction = Parameters<
  Parameters<Db["transaction"]>[0]
>[0];

export * from "./schema.js";
export { and, asc, eq, inArray, lt, or } from "drizzle-orm";
export {
  bootstrapAdmin,
  hashPassword,
  verifyPassword,
} from "./bootstrap-admin.js";
export { seedWatchSources, INITIAL_WATCH_SOURCES } from "./seed-watch-sources.js";
export { seedCandidates, INITIAL_CANDIDATES, KNOWN_PLATFORMS } from "./seed-candidates.js";
export { seedSpecs, INITIAL_SPECS, buildComparisonKey } from "./seed-specs.js";
