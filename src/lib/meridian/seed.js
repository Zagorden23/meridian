// Shared seeding logic — used by the /api/admin/seed route (PGLite/dev) and
// scripts/import-geodata.js (Neon/prod). Idempotent: every write is an upsert
// keyed on natural/source keys, so running twice never duplicates.
import { COUNTRIES, STATES, CITIES, AIRPORTS, AIRLINES, POIS, SEED_SOURCE, SEED_VERSION } from "./seed-data.js";
import { normalizeName } from "./geo-math.js";

const CAPITAL_BY_ISO2 = {
  IN: "delhi", US: "washington", GB: "london", FR: "paris", DE: "berlin", JP: "tokyo",
  CN: "beijing", SG: "singapore", AE: "abu-dhabi", AU: "canberra", CA: "ottawa",
  BR: "brasilia", MX: "mexico-city", AR: "buenos-aires", PE: "lima", EG: "cairo",
  ZA: "pretoria", KE: "nairobi", MA: "rabat", TR: "ankara", TH: "bangkok",
  MY: "kuala-lumpur", KR: "seoul", IT: "rome", ES: "madrid", NL: "amsterdam",
  CH: "bern", SE: "stockholm", NO: "oslo", IS: "reykjavik", GR: "athens",
  PT: "lisbon", AT: "vienna", IE: "dublin", QA: "doha", SA: "riyadh",
  NP: "kathmandu", NZ: "wellington",
};

export async function seedCurated(query) {
  const counts = { countries: 0, states: 0, cities: 0, airports: 0, airlines: 0, pois: 0 };
  for (const c of COUNTRIES) {
    await query(
      `INSERT INTO countries (id, name, official_name, iso2, iso3, continent, capital_city_id,
        latitude, longitude, timezone, currency, languages, flag, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, official_name=EXCLUDED.official_name,
        continent=EXCLUDED.continent, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
        timezone=EXCLUDED.timezone, currency=EXCLUDED.currency, languages=EXCLUDED.languages,
        flag=EXCLUDED.flag, updated_at=now()`,
      [c.id, c.name, c.officialName ?? null, c.iso2, c.iso3 ?? null, c.continent ?? null,
       CAPITAL_BY_ISO2[c.iso2] ?? null, c.latitude, c.longitude, c.timezone ?? null,
       c.currency ?? null, c.languages ?? null, c.flag ?? null, SEED_SOURCE, `${SEED_VERSION}:${c.id}`],
    );
    counts.countries += 1;
  }
  for (const s of STATES) {
    await query(
      `INSERT INTO states (id, country_id, name, code, latitude, longitude, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, code=EXCLUDED.code,
        latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, updated_at=now()`,
      [s.id, s.countryId, s.name, s.code ?? null, s.latitude ?? null, s.longitude ?? null, SEED_SOURCE, `${SEED_VERSION}:${s.id}`],
    );
    counts.states += 1;
  }
  for (const [id, name, countryId, stateId, lat, lon, tz, pop, capital] of CITIES) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    await query(
      `INSERT INTO cities (id, name, normalized_name, country_id, country_code, state_id, latitude,
        longitude, timezone, population, feature_class, feature_code, is_capital, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'P','PPL',$11,$12,$13,now())
       ON CONFLICT (source, source_id) DO UPDATE SET name=EXCLUDED.name, normalized_name=EXCLUDED.normalized_name,
        country_id=EXCLUDED.country_id, state_id=EXCLUDED.state_id, latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude, timezone=EXCLUDED.timezone, population=EXCLUDED.population,
        is_capital=EXCLUDED.is_capital, updated_at=now()`,
      [id, name, normalizeName(name), countryId, null, stateId, lat, lon, tz ?? null,
       pop ?? null, Boolean(capital), SEED_SOURCE, `${SEED_VERSION}:${id}`],
    );
    counts.cities += 1;
  }
  // Backfill country_code from countries.iso2.
  await query(
    `UPDATE cities SET country_code = countries.iso2 FROM countries
     WHERE cities.country_id = countries.id AND cities.country_code IS NULL`,
  );
  for (const [iata, icao, name, cityId, countryId, lat, lon, tz, type] of AIRPORTS) {
    await query(
      `INSERT INTO airports (id, iata, icao, name, city_id, country_id, latitude, longitude,
        timezone, type, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
       ON CONFLICT (source, source_id) DO UPDATE SET name=EXCLUDED.name, city_id=EXCLUDED.city_id,
        latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, timezone=EXCLUDED.timezone,
        type=EXCLUDED.type, updated_at=now()`,
      [`apt-${iata.toLowerCase()}`, iata, icao, name, cityId, countryId, lat, lon, tz ?? null,
       type ?? "international", SEED_SOURCE, `${SEED_VERSION}:${iata}`],
    );
    counts.airports += 1;
  }
  for (const [id, name, iataCode, icaoCode, countryId, type] of AIRLINES) {
    await query(
      `INSERT INTO airlines (id, name, iata_code, icao_code, country_id, type, active, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,now())
       ON CONFLICT (source, source_id) DO UPDATE SET name=EXCLUDED.name, iata_code=EXCLUDED.iata_code,
        icao_code=EXCLUDED.icao_code, type=EXCLUDED.type, updated_at=now()`,
      [id, name, iataCode, icaoCode, countryId, type ?? "international", SEED_SOURCE, `${SEED_VERSION}:${id}`],
    );
    counts.airlines += 1;
  }
  for (const [name, category, designation, cityId, countryId, lat, lon] of POIS) {
    const sid = `${SEED_VERSION}:${normalizeName(name)}`;
    await query(
      `INSERT INTO pois (id, name, normalized_name, category, designation, city_id, country_id,
        latitude, longitude, source, source_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       ON CONFLICT (source, source_id) DO UPDATE SET name=EXCLUDED.name, category=EXCLUDED.category,
        designation=EXCLUDED.designation, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
        updated_at=now()`,
      [`poi-${normalizeName(name).replace(/\s+/g, "-")}`, name, normalizeName(name), category,
       designation ?? null, cityId, countryId, lat, lon, SEED_SOURCE, sid],
    );
    counts.pois += 1;
  }
  return counts;
}

export async function logIngestion(query, dataset, source, records) {
  await query(
    "INSERT INTO ingestion_log (dataset, source, records, finished_at) VALUES ($1,$2,$3,now())",
    [dataset, source, records],
  );
}
