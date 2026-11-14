// GeoRepository — single persistence seam over the geographic catalog
// (countries, states, cities, airports, airlines, POIs) backed purely by MongoDB.

import { normalizeName } from "./geo-math.js";
import {
  Airline,
  Airport,
  City,
  Country,
  Poi,
  State,
  requireMongoConnection,
} from "./mongo.js";
import { seedCurated } from "./seed.js";

const globalForSeed = globalThis;

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampLat(lat) {
  return Math.max(-90, Math.min(90, Number(lat)));
}

function wrapLon(lon) {
  const n = Number(lon);
  if (!Number.isFinite(n)) return 0;
  return ((((n + 180) % 360) + 360) % 360) - 180;
}

function cleanDoc(doc) {
  if (!doc) return null;
  const { _id, __v, location: _location, _distanceMeters, ...rest } = doc;
  if (typeof _distanceMeters === "number") {
    rest.distanceKm = Math.round((_distanceMeters / 1000) * 100) / 100;
  }
  return rest;
}

async function ensureSeeded() {
  await requireMongoConnection();
  const [countriesCount, citiesCount] = await Promise.all([
    Country().estimatedDocumentCount(),
    City().estimatedDocumentCount(),
  ]);
  if (countriesCount > 0 && citiesCount > 0) return;

  if (!globalForSeed.__meridianGeoSeedPromise__) {
    globalForSeed.__meridianGeoSeedPromise__ = seedCurated()
      .catch((err) => {
        globalForSeed.__meridianGeoSeedPromise__ = null;
        throw err;
      })
      .finally(() => {
        globalForSeed.__meridianGeoSeedPromise__ = null;
      });
  }
  await globalForSeed.__meridianGeoSeedPromise__;
}

async function getCountryNameMap() {
  const rows = await Country().find({}, { _id: 0, id: 1, name: 1, iso2: 1 }).lean();
  const map = new Map();
  for (const r of rows) {
    map.set(r.id, { name: r.name, iso2: r.iso2 ?? null });
  }
  return map;
}

export async function listCountries() {
  await ensureSeeded();
  const rows = await Country()
    .find(
      {},
      {
        _id: 0,
        id: 1,
        name: 1,
        officialName: 1,
        iso2: 1,
        iso3: 1,
        continent: 1,
        capitalCityId: 1,
        latitude: 1,
        longitude: 1,
        timezone: 1,
        currency: 1,
        languages: 1,
        flag: 1,
      },
    )
    .sort({ name: 1 })
    .lean();
  return rows.map(cleanDoc);
}

export async function getCountry(idOrIso) {
  await ensureSeeded();
  const raw = String(idOrIso || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const doc = await Country()
    .findOne({ $or: [{ id: lower }, { id: raw }, { iso2: upper }, { iso3: upper }] })
    .lean();
  return cleanDoc(doc);
}

export async function getCountryStates(countryId) {
  await ensureSeeded();
  const rows = await State()
    .find(
      { countryId: String(countryId || "").trim() },
      { _id: 0, id: 1, countryId: 1, name: 1, code: 1, latitude: 1, longitude: 1 },
    )
    .sort({ name: 1 })
    .lean();
  return rows.map(cleanDoc);
}

export async function getCountryCities(countryId, limit = 50) {
  await ensureSeeded();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const rows = await City()
    .find(
      { countryId: String(countryId || "").trim() },
      {
        _id: 0,
        id: 1,
        name: 1,
        countryId: 1,
        countryCode: 1,
        stateId: 1,
        latitude: 1,
        longitude: 1,
        elevation: 1,
        timezone: 1,
        population: 1,
        isCapital: 1,
      },
    )
    .sort({ population: -1, name: 1 })
    .limit(safeLimit)
    .lean();
  return rows.map(cleanDoc);
}

function searchRank(base, nameNorm, norm, exactBonus = 0) {
  let score = base;
  if (nameNorm === norm) score += 60;
  else if (nameNorm.startsWith(norm)) score += 35;
  return score + exactBonus;
}

export async function searchCatalog(query, { limit = 12 } = {}) {
  await ensureSeeded();
  const q = String(query ?? "").trim();
  if (!q) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
  const norm = normalizeName(q);
  const normRx = new RegExp(escapeRegex(norm), "i");
  const normPrefixRx = new RegExp(`^${escapeRegex(norm)}`);
  const rawRx = new RegExp(escapeRegex(q), "i");
  const upperPrefixRx = new RegExp(`^${escapeRegex(q.toUpperCase())}`);
  const upperExact = q.toUpperCase();

  const [countryMap, cityDocs, countryDocs, airportDocs, poiDocs] = await Promise.all([
    getCountryNameMap(),
    City()
      .find(
        {
          $or: [
            { normalizedName: normPrefixRx },
            { normalizedName: normRx },
            { name: rawRx },
          ],
        },
        {
          _id: 0,
          id: 1,
          name: 1,
          normalizedName: 1,
          countryId: 1,
          countryCode: 1,
          stateId: 1,
          latitude: 1,
          longitude: 1,
          timezone: 1,
          population: 1,
          isCapital: 1,
        },
      )
      .sort({ isCapital: -1, population: -1 })
      .limit(safeLimit * 2)
      .lean(),
    Country()
      .find(
        {
          $or: [
            { name: rawRx },
            { officialName: rawRx },
            { iso2: upperExact },
            { iso3: upperExact },
          ],
        },
        {
          _id: 0,
          id: 1,
          name: 1,
          officialName: 1,
          iso2: 1,
          iso3: 1,
          continent: 1,
          capitalCityId: 1,
          flag: 1,
        },
      )
      .sort({ name: 1 })
      .limit(Math.min(safeLimit, 6))
      .lean(),
    Airport()
      .find(
        {
          $or: [
            { iata: upperExact },
            { icao: upperExact },
            { iata: upperPrefixRx },
            { name: rawRx },
          ],
        },
        {
          _id: 0,
          id: 1,
          iata: 1,
          icao: 1,
          name: 1,
          cityId: 1,
          countryId: 1,
          latitude: 1,
          longitude: 1,
          timezone: 1,
          type: 1,
        },
      )
      .sort({ iata: 1, name: 1 })
      .limit(Math.min(safeLimit, 8))
      .lean(),
    Poi()
      .find(
        {
          $or: [
            { normalizedName: normRx },
            { name: rawRx },
            { category: rawRx },
          ],
        },
        {
          _id: 0,
          id: 1,
          name: 1,
          category: 1,
          designation: 1,
          cityId: 1,
          countryId: 1,
          latitude: 1,
          longitude: 1,
        },
      )
      .sort({ name: 1 })
      .limit(Math.min(safeLimit, 6))
      .lean(),
  ]);

  const ranked = [];

  for (const c of cityDocs) {
    const meta = countryMap.get(c.countryId);
    const cleaned = cleanDoc(c);
    const cityNorm = cleaned.normalizedName || normalizeName(cleaned.name);
    delete cleaned.normalizedName;
    const bonus = (c.isCapital ? 10 : 0) + Math.min(8, Math.log10((c.population || 0) + 1));
    ranked.push({
      _score: searchRank(45, cityNorm, norm, bonus),
      kind: "CITY",
      ...cleaned,
      countryName: meta?.name ?? null,
      iso2: meta?.iso2 ?? c.countryCode ?? null,
    });
  }

  for (const a of airportDocs) {
    const cleaned = cleanDoc(a);
    const iataExact = a.iata === upperExact || a.icao === upperExact ? 75 : a.iata?.startsWith(upperExact) ? 35 : 0;
    ranked.push({
      _score: searchRank(35, normalizeName(a.name), norm, iataExact),
      kind: "AIRPORT",
      ...cleaned,
      countryName: countryMap.get(a.countryId)?.name ?? null,
    });
  }

  for (const co of countryDocs) {
    const cleaned = cleanDoc(co);
    const codeExact = co.iso2 === upperExact || co.iso3 === upperExact ? 65 : 0;
    ranked.push({
      _score: searchRank(40, normalizeName(co.name), norm, codeExact),
      kind: "COUNTRY",
      ...cleaned,
      countryName: co.continent ?? null,
    });
  }

  for (const p of poiDocs) {
    const cleaned = cleanDoc(p);
    ranked.push({
      _score: searchRank(30, normalizeName(p.name), norm),
      kind: "POI",
      ...cleaned,
      countryName: countryMap.get(p.countryId)?.name ?? null,
    });
  }

  ranked.sort((a, b) => b._score - a._score || String(a.name).localeCompare(String(b.name)));
  return ranked.slice(0, safeLimit).map(({ _score, ...hit }) => hit);
}

export async function getCity(id) {
  await ensureSeeded();
  const doc = await City().findOne({ id: String(id || "").trim() }).lean();
  if (!doc) return null;
  const country = await Country().findOne({ id: doc.countryId }, { _id: 0, name: 1, iso2: 1 }).lean();
  return {
    ...cleanDoc(doc),
    countryName: country?.name ?? null,
    iso2: country?.iso2 ?? doc.countryCode ?? null,
  };
}

export async function citiesInViewport(
  minLat,
  maxLat,
  minLon,
  maxLon,
  { limit = 200, minPopulation = 0 } = {},
) {
  await ensureSeeded();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const loLat = clampLat(Math.min(minLat, maxLat));
  const hiLat = clampLat(Math.max(minLat, maxLat));

  const lonFilter =
    minLon <= maxLon
      ? { longitude: { $gte: minLon, $lte: maxLon } }
      : { $or: [{ longitude: { $gte: minLon } }, { longitude: { $lte: maxLon } }] };

  const rows = await City()
    .find(
      {
        latitude: { $gte: loLat, $lte: hiLat },
        ...lonFilter,
        population: { $gte: Number(minPopulation) || 0 },
      },
      {
        _id: 0,
        id: 1,
        name: 1,
        countryId: 1,
        countryCode: 1,
        latitude: 1,
        longitude: 1,
        population: 1,
        isCapital: 1,
        timezone: 1,
      },
    )
    .sort({ population: -1 })
    .limit(safeLimit)
    .lean();

  return rows.map(cleanDoc);
}

export async function nearby(lat, lon, radiusKm = 100, { limit = 12 } = {}) {
  await ensureSeeded();
  const safeLat = clampLat(lat);
  const safeLon = wrapLon(lon);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 12, 50));
  const maxMeters = Math.max(1, Number(radiusKm) || 100) * 1000;

  const docs = await City().aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [safeLon, safeLat] },
        distanceField: "_distanceMeters",
        maxDistance: maxMeters,
        spherical: true,
      },
    },
    { $limit: safeLimit },
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        countryId: 1,
        countryCode: 1,
        latitude: 1,
        longitude: 1,
        population: 1,
        isCapital: 1,
        timezone: 1,
        _distanceMeters: 1,
      },
    },
  ]);

  return docs.map(cleanDoc);
}

export async function listAirports({ countryId, cityId, limit = 100 } = {}) {
  await ensureSeeded();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 300));
  const filter = {};
  if (countryId) filter.countryId = String(countryId).trim();
  if (cityId) filter.cityId = String(cityId).trim();

  const rows = await Airport()
    .find(filter, {
      _id: 0,
      id: 1,
      iata: 1,
      icao: 1,
      name: 1,
      cityId: 1,
      countryId: 1,
      latitude: 1,
      longitude: 1,
      elevation: 1,
      timezone: 1,
      type: 1,
    })
    .sort({ name: 1 })
    .limit(safeLimit)
    .lean();

  return rows.map(cleanDoc);
}

export async function getAirport(idOrCode) {
  await ensureSeeded();
  const raw = String(idOrCode || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const doc = await Airport()
    .findOne({ $or: [{ id: lower }, { id: raw }, { iata: upper }, { icao: upper }] })
    .lean();
  return cleanDoc(doc);
}

export async function nearestAirport(lat, lon) {
  await ensureSeeded();
  const safeLat = clampLat(lat);
  const safeLon = wrapLon(lon);
  const docs = await Airport().aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [safeLon, safeLat] },
        distanceField: "_distanceMeters",
        spherical: true,
      },
    },
    { $limit: 1 },
    {
      $project: {
        _id: 0,
        id: 1,
        iata: 1,
        icao: 1,
        name: 1,
        cityId: 1,
        countryId: 1,
        latitude: 1,
        longitude: 1,
        timezone: 1,
        type: 1,
        _distanceMeters: 1,
      },
    },
  ]);

  return docs.length ? cleanDoc(docs[0]) : null;
}

export async function listAirlines({ countryId, limit = 100 } = {}) {
  await ensureSeeded();
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 300));
  const filter = { active: true };
  if (countryId) filter.countryId = String(countryId).trim();

  const rows = await Airline()
    .find(filter, {
      _id: 0,
      id: 1,
      name: 1,
      iataCode: 1,
      icaoCode: 1,
      countryId: 1,
      type: 1,
      active: 1,
    })
    .sort({ name: 1 })
    .limit(safeLimit)
    .lean();

  return rows.map(cleanDoc);
}

export async function getAirline(idOrCode) {
  await ensureSeeded();
  const raw = String(idOrCode || "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const lower = raw.toLowerCase();
  const doc = await Airline()
    .findOne({
      $or: [
        { id: lower },
        { id: raw },
        { iataCode: upper },
        { icaoCode: upper },
      ],
    })
    .lean();
  return cleanDoc(doc);
}

export async function listCapitals() {
  await ensureSeeded();
  const [countryMap, rows] = await Promise.all([
    getCountryNameMap(),
    City()
      .find(
        { isCapital: true },
        {
          _id: 0,
          id: 1,
          name: 1,
          countryId: 1,
          countryCode: 1,
          latitude: 1,
          longitude: 1,
          timezone: 1,
          population: 1,
        },
      )
      .sort({ population: -1, name: 1 })
      .lean(),
  ]);

  return rows.map((r) => {
    const meta = countryMap.get(r.countryId);
    return {
      ...cleanDoc(r),
      countryName: meta?.name ?? null,
      iso2: meta?.iso2 ?? r.countryCode ?? null,
    };
  });
}

export async function poisNearby(lat, lon, radiusKm = 25, { category, limit = 20 } = {}) {
  await ensureSeeded();
  const safeLat = clampLat(lat);
  const safeLon = wrapLon(lon);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
  const maxMeters = Math.max(1, Number(radiusKm) || 25) * 1000;

  const geoStage = {
    $geoNear: {
      near: { type: "Point", coordinates: [safeLon, safeLat] },
      distanceField: "_distanceMeters",
      maxDistance: maxMeters,
      spherical: true,
      ...(category ? { query: { category: String(category).trim() } } : {}),
    },
  };

  const docs = await Poi().aggregate([
    geoStage,
    { $limit: safeLimit },
    {
      $project: {
        _id: 0,
        id: 1,
        name: 1,
        category: 1,
        designation: 1,
        cityId: 1,
        countryId: 1,
        latitude: 1,
        longitude: 1,
        _distanceMeters: 1,
      },
    },
  ]);

  return docs.map(cleanDoc);
}

export async function reverseGeocode(lat, lon) {
  await ensureSeeded();
  const [nearest, ap, countryMap] = await Promise.all([
    nearby(lat, lon, 250, { limit: 1 }),
    nearestAirport(lat, lon),
    getCountryNameMap(),
  ]);
  const nearestCity = nearest[0]
    ? {
        ...nearest[0],
        countryName: countryMap.get(nearest[0].countryId)?.name ?? null,
      }
    : null;
  const enrichedAirport = ap
    ? {
        ...ap,
        countryName: countryMap.get(ap.countryId)?.name ?? null,
      }
    : null;

  return {
    city: nearestCity,
    nearestCity,
    nearestAirport: enrichedAirport,
    coordinates: { lat, lon },
  };
}
