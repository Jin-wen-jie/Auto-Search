#!/usr/bin/env tsx
/* eslint-disable no-console */
import { createDb } from "./client.js";
import { seedWatchSources } from "./seed-watch-sources.js";
import {
  pruneRetiredSeedCandidates,
  seedCandidates,
} from "./seed-candidates.js";
import { seedSpecs } from "./seed-specs.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = createDb(databaseUrl, {
  maxConnections: 2,
  idleTimeoutSeconds: 5,
});

try {
  await seedWatchSources(db);
  console.log("✓ Watch sources seeded");

  await pruneRetiredSeedCandidates(db);
  console.log("✓ Retired seed candidates pruned");

  await seedCandidates(db);
  console.log("✓ Initial candidates seeded");

	await seedSpecs(db);
	console.log("✓ Product specs seeded");
} catch (error) {
  console.error("× Seed failed:", error);
  process.exit(1);
} finally {
  process.exit(0);
}
