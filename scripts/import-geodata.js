#!/usr/bin/env node
// MongoDB geo catalog importer (curated catalog + optional GeoNames TSV).
// Usage:
//   MONGODB_URI=... node scripts/import-geodata.js
//   MONGODB_URI=... node scripts/import-geodata.js --geonames ./cities15000.txt

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { normalizeName } from "../src/lib/meridian/geo-math.js";
import {
  City,
  Country,
  disconnectMongo,
  mongoConfigured,
  requireMongoConnection,
} from "../src/lib/meridian/mongo.js";
import { SEED_SOURCE } from "../src/lib/meridian/seed-data.js";
import { logIngestion, seedCurated } from "../src/lib/meridian/seed.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node scripts/import-geodata.js [--geonames <path/to/cities15000.txt>]

Imports curated geo catalog (and optionally GeoNames cities15000 TSV) into MongoDB.
Env: MONGODB_URI (required).`);
  process.exit(0);
}

if (!mongoConfigured()) {
  console.error("[import-geodata] MONGODB_URI is not set.");
  process.exit(1);
}

await requireMongoConnection();

const geonamesIdx = args.indexOf("--geonames");
const geonamesPath = geonamesIdx >= 0 ? args[geonamesIdx + 1] : null;

const counts = await seedCurated();
const total = Object.values(counts).reduce((a, b) => a + b, 0);
await logIngestion("curated", SEED_SOURCE, total);
console.log("[import-geodata] curated catalog:", counts);

if (geonamesPath) {
  if (!existsSync(geonamesPath)) {
    console.error(`[import-geodata] file not found: ${geonamesPath}`);
    await disconnectMongo();
    process.exit(1);
  }
  const isoRows = await Country().find({}, { _id: 0, id: 1, iso2: 1 }).lean();
  const isoMap = new Map(isoRows.map((c) => [c.iso2, c.id]));

  let count = 0;
  let batch = [];
  const rl = createInterface({ input: createReadStream(geonamesPath), crlfDelay: Infinity });

  async function flushBatch() {
    if (!batch.length) return;
    await City().bulkWrite(batch, { ordered: false });
    batch = [];
  }

  for await (const line of rl) {
    if (!line || line.startsWith("#")) continue;
    const cols = line.split("\t");
    if (cols.length < 18) continue;
    const [gid, name, , , latS, lonS, fclass, fcode, cc, , , , , , popS, elevS, , tz] = cols;
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const pop = Number(popS) || 0;
    const elev = elevS ? Number(elevS) : null;
    const countryId = isoMap.get(cc) ?? cc.toLowerCase();
    const id = `gn-${gid}`;
    batch.push({
      updateOne: {
        filter: { id },
        update: {
          $set: {
            id,
            name,
            normalizedName: normalizeName(name),
            countryId,
            countryCode: cc,
            latitude: lat,
            longitude: lon,
            location: { type: "Point", coordinates: [lon, lat] },
            elevation: elev,
            timezone: tz || null,
            population: pop,
            featureClass: fclass,
            featureCode: fcode,
            isCapital: fcode === "PPLC",
            source: "geonames",
            sourceId: gid,
            updatedAt: new Date(),
          },
        },
        upsert: true,
      },
    });
    count++;
    if (batch.length >= 500) {
      await flushBatch();
      process.stdout.write(`\r[import-geodata] geonames imported: ${count}`);
    }
  }
  await flushBatch();
  await logIngestion("geonames-cities", "geonames", count);
  console.log(`\n[import-geodata] geonames complete: ${count} cities`);
}

await disconnectMongo();
