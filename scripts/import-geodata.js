#!/usr/bin/env node
// MERIDIAN geographic ingestion pipeline (GATE: global geographic data).
// Idempotent: curated seed upserts on natural/source keys; GeoNames rows upsert
// on (source, source_id). Running twice never duplicates.
//
// Usage:
//   DATABASE_URL=... node scripts/import-geodata.js            # curated seed → Postgres
//   DATABASE_URL=... node scripts/import-geodata.js --geonames ./cities15000.txt
//   node scripts/import-geodata.js --help
//
// Without DATABASE_URL the script cannot reach the dev server's in-memory
// PGLite — use POST /api/admin/seed while the dev server runs instead.
import { readFile } from "node:fs/promises";

const { seedCurated, logIngestion } = await import("../src/lib/meridian/seed.js");
const { normalizeName } = await import("../src/lib/meridian/geo-math.js");

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(`import-geodata: seed curated catalog and/or GeoNames dump.

  --geonames <path>   ingest a GeoNames cities dump (tab-separated, geonames.org/export)
  --dry-run           parse only, write nothing
  --help              this text

Env: DATABASE_URL (required for direct import; otherwise use POST /api/admin/seed).`);
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const geonamesIdx = args.indexOf("--geonames");
const geonamesPath = geonamesIdx >= 0 ? args[geonamesIdx + 1] : null;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[import-geodata] DATABASE_URL is not set.");
  console.error("[import-geodata] Start the dev server and POST to /api/admin/seed for local seeding.");
  process.exit(1);
}

const { default: pg } = await import("pg");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
const query = (text, params) => client.query(text, params).then((r) => r.rows);

try {
  console.log("[import-geodata] applying curated seed…");
  if (!dryRun) {
    const counts = await seedCurated(query);
    await logIngestion(query, "meridian-curated", "seed-data", Object.values(counts).reduce((a, b) => a + b, 0));
    console.log("[import-geodata] curated counts:", counts);
  }
  if (geonamesPath) {
    console.log(`[import-geodata] ingesting GeoNames dump ${geonamesPath}…`);
    const text = await readFile(geonamesPath, "utf8");
    let n = 0;
    if (!dryRun) await client.query("BEGIN");
    try {
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const f = line.split("\t");
        // geonameid, name, asciiname, alternates, lat, lon, class, code, cc, ...
        const [gid, name, , , lat, lon, fclass, fcode, cc, , admin1, , , population, elevation, , timezone] = f;
        const la = Number(lat);
        const lo = Number(lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo) || la < -90 || la > 90 || lo < -180 || lo > 180) continue;
        const countryRows = await query("SELECT id FROM countries WHERE iso2 = $1 LIMIT 1", [cc]);
        const countryId = countryRows[0]?.id ?? null;
        if (!dryRun) {
          await query(
            `INSERT INTO cities (id, name, normalized_name, country_id, country_code, latitude, longitude,
              elevation, timezone, population, feature_class, feature_code, is_capital, source, source_id, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,'geonames',$13,now())
             ON CONFLICT (source, source_id) DO UPDATE SET name=EXCLUDED.name,
              normalized_name=EXCLUDED.normalized_name, population=EXCLUDED.population,
              timezone=EXCLUDED.timezone, updated_at=now()`,
            [`gn-${gid}`, name, normalizeName(name), countryId, cc || null, la, lo,
             elevation ? Number(elevation) : null, timezone || null,
             population ? Number(population) : null, fclass || null, fcode || null, `geonames:${gid}`],
          );
        }
        n += 1;
        void admin1;
      }
      if (!dryRun) {
        await client.query("COMMIT");
        await logIngestion(query, "geonames", geonamesPath, n);
      }
    } catch (err) {
      if (!dryRun) await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
    console.log(`[import-geodata] geonames rows: ${n}${dryRun ? " (dry run)" : ""}`);
  }
  console.log("[import-geodata] done.");
} catch (err) {
  console.error("[import-geodata] failed:", err?.message ?? err);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
