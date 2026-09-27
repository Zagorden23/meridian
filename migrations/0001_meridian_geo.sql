-- MERIDIAN geo/travel schema (GATE 2).
-- Portable SQL: runs on Neon Postgres and PGLite. No PostGIS dependency —
-- spatial queries use lat/lon bounding boxes + indexes (see geo-repository.js).
-- Every table is created IF NOT EXISTS; every seed uses idempotent upserts.

CREATE TABLE IF NOT EXISTS countries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  official_name TEXT,
  iso2 TEXT NOT NULL UNIQUE,
  iso3 TEXT,
  numeric_code TEXT,
  continent TEXT,
  capital_city_id TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  timezone TEXT,
  currency TEXT,
  languages TEXT,
  flag TEXT,
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS states (
  id TEXT PRIMARY KEY,
  country_id TEXT NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country_id, name)
);

CREATE TABLE IF NOT EXISTS cities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  country_code TEXT,
  state_id TEXT REFERENCES states(id) ON DELETE SET NULL,
  state_code TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  elevation INTEGER,
  timezone TEXT,
  population BIGINT,
  feature_class TEXT,
  feature_code TEXT,
  is_capital BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_cities_country ON cities(country_id);
CREATE INDEX IF NOT EXISTS idx_cities_state ON cities(state_id);
CREATE INDEX IF NOT EXISTS idx_cities_latlon ON cities(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_cities_normalized ON cities(normalized_name);
CREATE INDEX IF NOT EXISTS idx_cities_capital ON cities(is_capital) WHERE is_capital = TRUE;
CREATE INDEX IF NOT EXISTS idx_cities_population ON cities(population DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS airports (
  id TEXT PRIMARY KEY,
  iata TEXT,
  icao TEXT,
  name TEXT NOT NULL,
  city_id TEXT REFERENCES cities(id) ON DELETE SET NULL,
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  timezone TEXT,
  elevation INTEGER,
  type TEXT NOT NULL DEFAULT 'international',
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_airports_iata ON airports(iata);
CREATE INDEX IF NOT EXISTS idx_airports_city ON airports(city_id);
CREATE INDEX IF NOT EXISTS idx_airports_country ON airports(country_id);
CREATE INDEX IF NOT EXISTS idx_airports_latlon ON airports(latitude, longitude);

CREATE TABLE IF NOT EXISTS airlines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  iata_code TEXT,
  icao_code TEXT,
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  logo TEXT,
  type TEXT NOT NULL DEFAULT 'international',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_airlines_iata ON airlines(iata_code);

CREATE TABLE IF NOT EXISTS pois (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  category TEXT NOT NULL,
  designation TEXT,
  city_id TEXT REFERENCES cities(id) ON DELETE SET NULL,
  country_id TEXT REFERENCES countries(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL DEFAULT 'meridian-curated',
  source_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_pois_latlon ON pois(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_pois_category ON pois(category);
CREATE INDEX IF NOT EXISTS idx_pois_normalized ON pois(normalized_name);

-- Short-TTL caches. Weather: current ~10 min, forecast ~3 h (see weather-service.js).
CREATE TABLE IF NOT EXISTS weather_cache (
  key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_weather_cache_expires ON weather_cache(expires_at);

-- Ephemeral live-position store: one row per tracked flight, short TTL.
CREATE TABLE IF NOT EXISTS flight_positions (
  flight_id TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_log (
  id SERIAL PRIMARY KEY,
  dataset TEXT NOT NULL,
  source TEXT NOT NULL,
  records INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
