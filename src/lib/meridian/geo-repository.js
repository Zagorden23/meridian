// GeoRepository — the ONLY module that issues geo SQL. Components, AI tools
// and API routes go through here, so a future PostGIS move touches one file.
// Portable SQL (bbox prefilter); haversine refinement happens in JS.
import { getSql } from "@/lib/db.js";
import { boundingBox, distanceKm, normalizeName } from "./geo-math.js";
import { seedCurated } from "./seed.js";

const globalRef = globalThis;

async function sql() {
  const db = await getSql();
  // Auto-seed curated catalog once when empty (covers both in-memory PGLite
  // and freshly provisioned Postgres instances).
  globalRef.__meridianCatalogSeeded__ ??= (async () => {
    const rows = await db.query("SELECT 1 FROM countries LIMIT 1");
    if (!rows.length) {
      await seedCurated(db.query);
    }
  })().catch((err) => {
    globalRef.__meridianCatalogSeeded__ = undefined;
    throw err;
  });
  await globalRef.__meridianCatalogSeeded__;
  return db;
}

// --- Countries -------------------------------------------------------------
export async function listCountries() {
  const db = await sql();
  return db.query("SELECT * FROM countries ORDER BY name ASC");
}

export async function getCountry(idOrIso) {
  const db = await sql();
  const key = String(idOrIso ?? "").toUpperCase();
  const rows = await db.query(
    "SELECT * FROM countries WHERE id = $1 OR iso2 = $1 OR iso3 = $1 LIMIT 1",
    [idOrIso],
  );
  if (rows.length) return rows[0];
  const rows2 = await db.query("SELECT * FROM countries WHERE iso2 = $1 LIMIT 1", [key]);
  return rows2[0] ?? null;
}

export async function getCountryStates(countryId) {
  const db = await sql();
  return db.query("SELECT * FROM states WHERE country_id = $1 ORDER BY name ASC", [countryId]);
}

export async function getCountryCities(countryId, limit = 50) {
  const db = await sql();
  return db.query(
    "SELECT * FROM cities WHERE country_id = $1 ORDER BY population DESC NULLS LAST, name ASC LIMIT $2",
    [countryId, limit],
  );
}

// --- Search (ranked: exact → normalized → capital → population) -------------
export async function searchCatalog(query, { limit = 12 } = {}) {
  const db = await sql();
  const q = String(query ?? "").trim();
  if (!q) return [];
  const norm = normalizeName(q);
  const like = `%${norm}%`;
  const cities = await db.query(
    `SELECT id, name, country_id AS "countryId", state_id AS "stateId", latitude, longitude,
            population, is_capital AS "isCapital", timezone,
            CASE WHEN normalized_name = $1 THEN 0
                 WHEN normalized_name LIKE $2 THEN 1 ELSE 2 END AS rank
       FROM cities WHERE normalized_name = $1 OR normalized_name LIKE $2
       ORDER BY rank ASC, "isCapital" DESC, population DESC NULLS LAST LIMIT $3`,
    [norm, like, limit],
  );
  const countries = await db.query(
    "SELECT id, name, iso2, latitude, longitude FROM countries WHERE LOWER(name) LIKE $1 ORDER BY name ASC LIMIT 4",
    [`%${q.toLowerCase()}%`],
  );
  const airports = await db.query(
    `SELECT id, iata, icao, name, city_id AS "cityId", country_id AS "countryId",
            latitude, longitude, type
       FROM airports WHERE UPPER(iata) = $1 OR UPPER(icao) = $1 OR LOWER(name) LIKE $2 LIMIT 4`,
    [q.toUpperCase(), `%${q.toLowerCase()}%`],
  );
  const results = [
    ...countries.map((c) => ({ kind: "COUNTRY", ...c })),
    ...cities.map((c) => ({ kind: "CITY", ...c })),
    ...airports.map((a) => ({ kind: "AIRPORT", ...a })),
  ];
  return results.slice(0, limit);
}

export async function getCity(id) {
  const db = await sql();
  const rows = await db.query("SELECT * FROM cities WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ?? null;
}

// --- Viewport / nearby (bbox SQL prefilter + haversine refine) --------------
export async function citiesInViewport(minLat, maxLat, minLon, maxLon, { limit = 200, minPopulation = 0 } = {}) {
  const db = await sql();
  return db.query(
    `SELECT id, name, country_id AS "countryId", latitude, longitude, population,
            is_capital AS "isCapital"
       FROM cities
       WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4
         AND population >= $5
       ORDER BY population DESC NULLS LAST LIMIT $6`,
    [minLat, maxLat, minLon, maxLon, minPopulation, limit],
  );
}

export async function nearby(lat, lon, radiusKm = 100, { limit = 12 } = {}) {
  const db = await sql();
  const box = boundingBox(lat, lon, radiusKm);
  const rows = await db.query(
    `SELECT id, name, country_id AS "countryId", latitude, longitude, population,
            is_capital AS "isCapital", 'CITY' AS kind
       FROM cities WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4 LIMIT 200`,
    [box.minLat, box.maxLat, box.minLon, box.maxLon],
  );
  return rows
    .map((r) => ({ ...r, distanceKm: distanceKm(lat, lon, r.latitude, r.longitude) }))
    .filter((r) => r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

// --- Airports / airlines ----------------------------------------------------
export async function listAirports({ countryId, cityId, limit = 100 } = {}) {
  const db = await sql();
  const conds = [];
  const params = [];
  if (countryId) {
    params.push(countryId);
    conds.push(`country_id = $${params.length}`);
  }
  if (cityId) {
    params.push(cityId);
    conds.push(`city_id = $${params.length}`);
  }
  params.push(limit);
  return db.query(
    `SELECT * FROM airports ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""} ORDER BY name ASC LIMIT $${params.length}`,
    params,
  );
}

export async function getAirport(idOrCode) {
  const db = await sql();
  const code = String(idOrCode ?? "").toUpperCase();
  const rows = await db.query(
    "SELECT * FROM airports WHERE id = $1 OR iata = $2 OR icao = $2 LIMIT 1",
    [idOrCode, code],
  );
  return rows[0] ?? null;
}

export async function nearestAirport(lat, lon) {
  const db = await sql();
  const box = boundingBox(lat, lon, 500);
  const rows = await db.query(
    "SELECT * FROM airports WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4 LIMIT 200",
    [box.minLat, box.maxLat, box.minLon, box.maxLon],
  );
  let best = null;
  for (const r of rows) {
    const d = distanceKm(lat, lon, r.latitude, r.longitude);
    if (!best || d < best.distanceKm) best = { ...r, distanceKm: d };
  }
  return best;
}

export async function listAirlines({ countryId, limit = 100 } = {}) {
  const db = await sql();
  if (countryId) {
    return db.query("SELECT * FROM airlines WHERE country_id = $1 ORDER BY name ASC LIMIT $2", [
      countryId,
      limit,
    ]);
  }
  return db.query("SELECT * FROM airlines ORDER BY name ASC LIMIT $1", [limit]);
}

export async function getAirline(idOrCode) {
  const db = await sql();
  const code = String(idOrCode ?? "").toUpperCase();
  const rows = await db.query(
    "SELECT * FROM airlines WHERE id = $1 OR iata_code = $2 OR icao_code = $2 LIMIT 1",
    [idOrCode, code],
  );
  return rows[0] ?? null;
}

// --- Capitals / POIs ---------------------------------------------------------
export async function listCapitals() {
  const db = await sql();
  return db.query(
    "SELECT * FROM cities WHERE is_capital = TRUE ORDER BY population DESC NULLS LAST, name ASC",
  );
}

export async function poisNearby(lat, lon, radiusKm = 25, { category, limit = 20 } = {}) {
  const db = await sql();
  const box = boundingBox(lat, lon, radiusKm);
  const params = [box.minLat, box.maxLat, box.minLon, box.maxLon];
  let extra = "";
  if (category) {
    params.push(category);
    extra = `AND category = $${params.length}`;
  }
  params.push(300);
  const rows = await db.query(
    `SELECT * FROM pois WHERE latitude BETWEEN $1 AND $2 AND longitude BETWEEN $3 AND $4 ${extra} LIMIT $${params.length}`,
    params,
  );
  return rows
    .map((r) => ({ ...r, distanceKm: distanceKm(lat, lon, r.latitude, r.longitude) }))
    .filter((r) => r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

// --- Reverse geocode (nearest city + country) --------------------------------
export async function reverseGeocode(lat, lon) {
  const city = (await nearby(lat, lon, 500, { limit: 1 }))[0] ?? null;
  let country = null;
  if (city?.country_id) {
    const db = await sql();
    const rows = await db.query("SELECT * FROM countries WHERE id = $1 LIMIT 1", [city.country_id]);
    country = rows[0] ?? null;
  }
  return { city, country };
}
