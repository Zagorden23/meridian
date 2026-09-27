#!/usr/bin/env node
// MERIDIAN geodata updater: re-runs the idempotent pipeline (curated seed,
// optional GeoNames refresh) and expires stale weather cache rows. Safe for
// cron: never deletes catalog data, only expired cache entries.
//
// Usage:
//   DATABASE_URL=... node scripts/update-geodata.js [--geonames <path>]
//   npm run db:update-geodata
import { createRequire } from "node:module";

createRequire(import.meta.url);
const args = process.argv.slice(2);
const gi = args.indexOf("--geonames");

if (!process.env.DATABASE_URL) {
  console.log("[update-geodata] DATABASE_URL not set — nothing to update (dev uses in-app seed).");
  process.exit(0);
}

const { spawnSync } = await import("node:child_process");
const importArgs = ["scripts/import-geodata.js"];
if (gi >= 0 && args[gi + 1]) importArgs.push("--geonames", args[gi + 1]);
const r = spawnSync(process.execPath, importArgs, { stdio: "inherit", env: process.env });
if (r.status !== 0) process.exit(r.status ?? 1);

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const res = await pool.query("DELETE FROM weather_cache WHERE expires_at <= now()");
  console.log(`[update-geodata] expired weather rows removed: ${res.rowCount}`);
  const res2 = await pool.query("DELETE FROM flight_positions WHERE expires_at <= now()");
  console.log(`[update-geodata] expired flight-position rows removed: ${res2.rowCount}`);
} finally {
  await pool.end();
}
console.log("[update-geodata] done.");
