import { createDb, type Db } from "@compare/db";

let database: Db | undefined;

export function getDatabase(): Db {
  if (database) return database;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  database = createDb(databaseUrl, {
    maxConnections: 1,
    idleTimeoutSeconds: 20,
  });
  return database;
}
