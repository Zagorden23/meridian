// WeatherService — frontend NEVER calls providers directly.
// Flow: API route → getWeather() → cache (weather_cache) → Open-Meteo
// (keyless, coordinate-based) → normalize → cache → response.
// Failures: recent cache with `cached:true` + timestamp, else 503-style error.
// Never fabricate values; missing fields are null.
import { getSql } from "@/lib/db.js";
import { TTL, withFreshness } from "./data-freshness.js";
import { validateLatLon } from "./geo-math.js";

const CURRENT_URL = "https://api.open-meteo.com/v1/forecast";
const SOURCE = "open-meteo";

const CURRENT_FIELDS =
  "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,visibility";

const CODE_MAP = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing rime fog", 51: "Light drizzle", 53: "Moderate drizzle",
  55: "Dense drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle", 61: "Slight rain",
  63: "Moderate rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Slight showers", 81: "Moderate showers", 82: "Violent showers",
  85: "Slight snow showers", 86: "Heavy snow showers", 95: "Thunderstorm",
  96: "Thunderstorm with hail", 99: "Thunderstorm with hail",
};

const memCache = new Map(); // key → { payload, expiresAt }

function cacheKey(lat, lon) {
  return `wx:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
}

async function readCache(key) {
  const mem = memCache.get(key);
  if (mem && Date.parse(mem.expiresAt) > Date.now()) return { ...mem.payload, cached: true };
  try {
    const db = await getSql();
    const rows = await db.query("SELECT payload, expires_at FROM weather_cache WHERE key = $1", [key]);
    if (!rows.length) return null;
    const row = rows[0];
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    memCache.set(key, { payload, expiresAt: row.expires_at });
    return { ...payload, cached: true };
  } catch {
    return mem ? { ...mem.payload, cached: true, stale: true } : null;
  }
}

async function writeCache(key, payload, ttlMs) {
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  memCache.set(key, { payload, expiresAt });
  try {
    const db = await getSql();
    await db.query(
      `INSERT INTO weather_cache (key, payload, fetched_at, expires_at)
       VALUES ($1, $2, now(), $3)
       ON CONFLICT (key) DO UPDATE SET payload = EXCLUDED.payload, fetched_at = now(), expires_at = EXCLUDED.expires_at`,
      [key, JSON.stringify(payload), expiresAt],
    );
  } catch {
    // DB cache is best-effort; memory cache already holds the value.
  }
}

function normalize(location, lat, lon, json) {
  const c = json?.current ?? {};
  const d = json?.daily ?? {};
  const fetchedAt = new Date().toISOString();
  return withFreshness(
    {
      location: location ?? null,
      latitude: Number(lat),
      longitude: Number(lon),
      timestamp: c.time ?? fetchedAt,
      temperature: c.temperature_2m ?? null,
      feelsLike: c.apparent_temperature ?? null,
      humidity: c.relative_humidity_2m ?? null,
      pressure: c.pressure_msl ?? null,
      windSpeed: c.wind_speed_10m ?? null,
      windDirection: c.wind_direction_10m ?? null,
      visibility: c.visibility ?? null,
      cloudCover: c.cloud_cover ?? null,
      precipitation: c.precipitation ?? null,
      weatherCode: c.weather_code ?? null,
      condition: CODE_MAP[c.weather_code] ?? (c.weather_code == null ? null : "Unknown"),
      isDay: c.is_day == null ? null : c.is_day === 1,
      forecast: Array.isArray(d.time)
        ? d.time.slice(0, 5).map((date, i) => ({
            date,
            tempMax: d.temperature_2m_max?.[i] ?? null,
            tempMin: d.temperature_2m_min?.[i] ?? null,
            precipitationProbability: d.precipitation_probability_max?.[i] ?? null,
            weatherCode: d.weather_code?.[i] ?? null,
            condition: CODE_MAP[d.weather_code?.[i]] ?? null,
          }))
        : [],
      source: SOURCE,
      fetchedAt,
    },
    TTL.weatherCurrentMs,
  );
}

export async function getWeather({ lat, lon, location = null }) {
  if (!validateLatLon(lat, lon)) {
    throw Object.assign(new Error("Invalid coordinates"), { status: 400, code: "INVALID_COORDS" });
  }
  const key = cacheKey(lat, lon);
  const url =
    `${CURRENT_URL}?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}` +
    `&current=${CURRENT_FIELDS}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&hourly=temperature_2m&forecast_days=5&timezone=auto&wind_speed_unit=kmh`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Weather provider responded ${res.status}`);
    const json = await res.json();
    const payload = normalize(location, lat, lon, json);
    await writeCache(key, payload, TTL.weatherCurrentMs);
    // Best-effort MongoDB Atlas mirror (TTL 30 min); never blocks/fails.
    try {
      const { cacheWeatherMongo } = await import("./mongo.js");
      await cacheWeatherMongo({ lat, lon, payload, source: SOURCE });
    } catch { /* fallback cache already written */ }
    return { ...payload, cached: false };
  } catch (err) {
    const cached = await readCache(key);
    if (cached) return { ...cached, stale: true, source: cached.source ?? SOURCE };
    const e = new Error("Weather temporarily unavailable.");
    e.status = 503;
    e.code = "WEATHER_UNAVAILABLE";
    e.cause = err;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export function weatherCondition(code) {
  return CODE_MAP[code] ?? null;
}
