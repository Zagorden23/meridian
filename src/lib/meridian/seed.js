// Shared MongoDB seeding logic — used by GeoRepository auto-seed,
// /api/admin/seed, and scripts/import-geodata.js. Idempotent bulk upserts.

import { normalizeName } from "./geo-math.js";
import {
  Airline,
  Airport,
  City,
  Country,
  IngestionLog,
  Poi,
  State,
  requireMongoConnection,
} from "./mongo.js";
import {
  AIRLINES,
  AIRPORTS,
  CITIES,
  COUNTRIES,
  POIS,
  SEED_SOURCE,
  SEED_VERSION,
  STATES,
} from "./seed-data.js";

function toGeoPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  return { type: "Point", coordinates: [lon, lat] };
}

export async function seedCurated() {
  await requireMongoConnection();
  const now = new Date();

  const countryIsoMap = new Map(COUNTRIES.map((c) => [c.id, c.iso2]));
  const capitalCityByCountry = new Map();
  for (const [id, , countryId, , , , , , capital] of CITIES) {
    if (capital && !capitalCityByCountry.has(countryId)) {
      capitalCityByCountry.set(countryId, id);
    }
  }

  if (COUNTRIES.length) {
    await Country().bulkWrite(
      COUNTRIES.map((c) => ({
        updateOne: {
          filter: { id: c.id },
          update: {
            $set: {
              id: c.id,
              name: c.name,
              officialName: c.officialName,
              iso2: c.iso2,
              iso3: c.iso3,
              continent: c.continent,
              capitalCityId: capitalCityByCountry.get(c.id) ?? null,
              latitude: c.lat,
              longitude: c.lon,
              location: toGeoPoint(c.lat, c.lon),
              timezone: c.tz,
              currency: c.currency,
              languages: c.languages ?? [],
              flag: c.flag ?? null,
              source: SEED_SOURCE,
              sourceId: `${SEED_VERSION}:${c.id}`,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  if (STATES.length) {
    await State().bulkWrite(
      STATES.map((s) => ({
        updateOne: {
          filter: { id: s.id },
          update: {
            $set: {
              id: s.id,
              countryId: s.countryId,
              name: s.name,
              code: s.code ?? null,
              latitude: s.latitude ?? null,
              longitude: s.longitude ?? null,
              location: toGeoPoint(s.latitude, s.longitude),
              source: SEED_SOURCE,
              sourceId: `${SEED_VERSION}:${s.id}`,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  // Deduplicate CITIES by id (seed-data has a repeated vienna row) before bulkWrite.
  const dedupCities = new Map();
  for (const [id, name, countryId, stateId, lat, lon, tz, pop, capital] of CITIES) {
    dedupCities.set(id, [id, name, countryId, stateId, lat, lon, tz, pop, capital]);
  }
  const cityEntries = Array.from(dedupCities.values());
  if (cityEntries.length) {
    await City().bulkWrite(
      cityEntries.map(([id, name, countryId, stateId, lat, lon, tz, pop, capital]) => ({
        updateOne: {
          filter: { id },
          update: {
            $set: {
              id,
              name,
              normalizedName: normalizeName(name),
              countryId,
              countryCode: countryIsoMap.get(countryId) ?? null,
              stateId: stateId ?? null,
              latitude: lat,
              longitude: lon,
              location: { type: "Point", coordinates: [lon, lat] },
              timezone: tz ?? null,
              population: pop ?? 0,
              featureClass: "P",
              featureCode: capital ? "PPLC" : "PPL",
              isCapital: Boolean(capital),
              source: SEED_SOURCE,
              sourceId: `${SEED_VERSION}:${id}`,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  if (AIRPORTS.length) {
    await Airport().bulkWrite(
      AIRPORTS.map(([iata, icao, name, cityId, countryId, lat, lon, tz, type]) => {
        const id = `apt-${iata.toLowerCase()}`;
        return {
          updateOne: {
            filter: { id },
            update: {
              $set: {
                id,
                iata,
                icao,
                name,
                cityId: cityId ?? null,
                countryId,
                latitude: lat,
                longitude: lon,
                location: { type: "Point", coordinates: [lon, lat] },
                timezone: tz ?? null,
                type: type ?? "international",
                source: SEED_SOURCE,
                sourceId: `${SEED_VERSION}:${iata}`,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  if (AIRLINES.length) {
    await Airline().bulkWrite(
      AIRLINES.map(([id, name, iataCode, icaoCode, countryId, type]) => ({
        updateOne: {
          filter: { id },
          update: {
            $set: {
              id,
              name,
              iataCode,
              icaoCode,
              countryId,
              type: type ?? "international",
              active: true,
              source: SEED_SOURCE,
              sourceId: `${SEED_VERSION}:${id}`,
              updatedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  if (POIS.length) {
    await Poi().bulkWrite(
      POIS.map(([name, category, designation, cityId, countryId, lat, lon]) => {
        const slug = normalizeName(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const sid = `${SEED_VERSION}:poi:${slug}`;
        const id = `poi-${slug}`;
        return {
          updateOne: {
            filter: { id },
            update: {
              $set: {
                id,
                name,
                normalizedName: normalizeName(name),
                category,
                designation: designation ?? null,
                cityId: cityId ?? null,
                countryId,
                latitude: lat,
                longitude: lon,
                location: { type: "Point", coordinates: [lon, lat] },
                source: SEED_SOURCE,
                sourceId: sid,
                updatedAt: now,
              },
            },
            upsert: true,
          },
        };
      }),
      { ordered: false },
    );
  }

  return {
    countries: COUNTRIES.length,
    states: STATES.length,
    cities: cityEntries.length,
    airports: AIRPORTS.length,
    airlines: AIRLINES.length,
    pois: POIS.length,
  };
}

export async function logIngestion(datasetOrUnused, sourceOrDataset, recordsOrSource, maybeRecords) {
  await requireMongoConnection();
  const isLegacy = typeof datasetOrUnused === "function";
  const dataset = isLegacy ? sourceOrDataset : datasetOrUnused;
  const source = isLegacy ? recordsOrSource : sourceOrDataset;
  const records = isLegacy ? maybeRecords : recordsOrSource;
  await IngestionLog().create({
    dataset: String(dataset || "unknown"),
    source: String(source || SEED_SOURCE),
    records: Number(records || 0),
    finishedAt: new Date(),
  });
}
