#!/usr/bin/env node
// Re-syncs curated catalog and purges expired weather & flight caches in MongoDB.
// Usage:
//   MONGODB_URI=... node scripts/update-geodata.js [--geonames <path>]

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FlightPosition,
  WeatherSnapshot,
  disconnectMongo,
  mongoConfigured,
  requireMongoConnection,
} from "../src/lib/meridian/mongo.js";
import { SEED_SOURCE } from "../src/lib/meridian/seed-data.js";
import { logIngestion, seedCurated } from "../src/lib/meridian/seed.js";

if (!mongoConfigured()) {
  console.log("[update-geodata] MONGODB_URI not set — nothing to update.");
  process.exit(0);
}

const args = process.argv.slice(2);
const dir = dirname(fileURLToPath(import.meta.url));
if (args.includes("--geonames")) {
  const res = spawnSync(process.execPath, [join(dir, "import-geodata.js"), ...args], {
    stdio: "inherit",
  });
  process.exit(res.status ?? 0);
}

await requireMongoConnection();
const counts = await seedCurated();
const total = Object.values(counts).reduce((a, b) => a + b, 0);
await logIngestion("update-curated", SEED_SOURCE, total);

const now = new Date();
await Promise.all([
  WeatherSnapshot().deleteMany({ expiresAt: { $lte: now } }),
  FlightPosition().deleteMany({ expiresAt: { $lte: now } }),
]);
await disconnectMongo();
console.log("[update-geodata] refreshed:", counts);
