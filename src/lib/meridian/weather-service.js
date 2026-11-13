// Weather service: Open-Meteo (default, keyless) or MET Norway,
// cached in-memory and in MongoDB (`WeatherSnapshot` collection with TTL).

import { validateLatLon } from "./geo-math.js";
import { cacheWeatherMongo, connectMongo, WeatherSnapshot } from "./mongo.js";

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const memCache = new Map();

function cacheKey(lat, lon) {
  return `wx:${lat.toFixed(2)},${lon.toFixed(2)}`;
}

async function readCache(key) {
  const mem = memCache.get(key);
  if (mem && Date.now() < mem.exp) return mem.data;

  try {
    const conn = await connectMongo();
    if (!conn) return null;
    const now = new Date();
    const doc = await WeatherSnapshot()
      .findOne({ key, expiresAt: { $gt: now } }, { _id: 0, payload: 1, expiresAt: 1 })
      .lean();
    if (!doc?.payload) return null;
    memCache.set(key, {
      exp: doc.expiresAt ? new Date(doc.expiresAt).getTime() : Date.now() + TTL_MS,
      data: doc.payload,
    });
    return doc.payload;
  } catch {
    return null;
  }
}

async function writeCache(key, lat, lon, provider, payload) {
  memCache.set(key, { exp: Date.now() + TTL_MS, data: payload });
  try {
    await cacheWeatherMongo(lat, lon, provider, payload, TTL_MS, key);
  } catch {
    // non-fatal cache write error
  }
}

const WMO_LABELS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow",
  73: "Moderate snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm with hail",
};

async function fetchOpenMeteo(lat, lon) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,is_day",
  );
  url.searchParams.set(
    "hourly",
    "temperature_2m,precipitation_probability,weather_code,wind_speed_10m",
  );
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset,uv_index_max",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "7");

  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    const err = new Error(`Open-Meteo HTTP ${res.status}`);
    err.status = 502;
    err.code = "WEATHER_UPSTREAM_ERROR";
    throw err;
  }
  const j = await res.json();
  const c = j.current ?? {};

  let aqi = null;
  try {
    const aqiUrl = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    aqiUrl.searchParams.set("latitude", String(lat));
    aqiUrl.searchParams.set("longitude", String(lon));
    aqiUrl.searchParams.set("current", "us_aqi,pm2_5,pm10");
    const ar = await fetch(aqiUrl.toString(), { signal: AbortSignal.timeout(5000) });
    if (ar.ok) {
      const aj = await ar.json();
      if (aj.current) {
        aqi = {
          usAqi: aj.current.us_aqi ?? null,
          pm25: aj.current.pm2_5 ?? null,
          pm10: aj.current.pm10 ?? null,
        };
      }
    }
  } catch {
    // optional enrichment
  }

  return {
    provider: "open-meteo",
    coordinates: { lat: j.latitude ?? lat, lon: j.longitude ?? lon },
    timezone: j.timezone ?? "UTC",
    elevation: j.elevation ?? null,
    current: {
      temperatureC: c.temperature_2m ?? null,
      apparentTemperatureC: c.apparent_temperature ?? null,
      humidityPct: c.relative_humidity_2m ?? null,
      windSpeedKmh: c.wind_speed_10m ?? null,
      windDirectionDeg: c.wind_direction_10m ?? null,
      precipitationMm: c.precipitation ?? 0,
      cloudCoverPct: c.cloud_cover ?? null,
      pressureHpa: c.surface_pressure ?? null,
      weatherCode: c.weather_code ?? null,
      condition: WMO_LABELS[c.weather_code] ?? "Variable",
      isDay: c.is_day === 1,
      observedAt: c.time ?? new Date().toISOString(),
    },
    hourly: (j.hourly?.time ?? []).slice(0, 24).map((t, i) => ({
      time: t,
      temperatureC: j.hourly.temperature_2m?.[i] ?? null,
      precipProbPct: j.hourly.precipitation_probability?.[i] ?? null,
      windSpeedKmh: j.hourly.wind_speed_10m?.[i] ?? null,
      weatherCode: j.hourly.weather_code?.[i] ?? null,
      condition: WMO_LABELS[j.hourly.weather_code?.[i]] ?? "Variable",
    })),
    daily: (j.daily?.time ?? []).map((d, i) => ({
      date: d,
      tempMaxC: j.daily.temperature_2m_max?.[i] ?? null,
      tempMinC: j.daily.temperature_2m_min?.[i] ?? null,
      precipSumMm: j.daily.precipitation_sum?.[i] ?? 0,
      uvIndexMax: j.daily.uv_index_max?.[i] ?? null,
      sunrise: j.daily.sunrise?.[i] ?? null,
      sunset: j.daily.sunset?.[i] ?? null,
      weatherCode: j.daily.weather_code?.[i] ?? null,
      condition: WMO_LABELS[j.daily.weather_code?.[i]] ?? "Variable",
    })),
    airQuality: aqi,
  };
}

async function fetchMetNorway(lat, lon) {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "MeridianGeo/1.0 https://github.com/meridian-geo" },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) {
    const err = new Error(`MET Norway HTTP ${res.status}`);
    err.status = 502;
    err.code = "WEATHER_UPSTREAM_ERROR";
    throw err;
  }
  const j = await res.json();
  const series = j.properties?.timeseries ?? [];
  const first = series[0]?.data?.instant?.details ?? {};
  const symbol = series[0]?.data?.next_1_hours?.summary?.symbol_code ?? "partlycloudy";
  return {
    provider: "met-norway",
    coordinates: { lat, lon },
    timezone: "UTC",
    current: {
      temperatureC: first.air_temperature ?? null,
      apparentTemperatureC: first.air_temperature ?? null,
      humidityPct: first.relative_humidity ?? null,
      windSpeedKmh: first.wind_speed != null ? Math.round(first.wind_speed * 3.6 * 10) / 10 : null,
      windDirectionDeg: first.wind_from_direction ?? null,
      precipitationMm: series[0]?.data?.next_1_hours?.details?.precipitation_amount ?? 0,
      cloudCoverPct: first.cloud_area_fraction ?? null,
      pressureHpa: first.air_pressure_at_sea_level ?? null,
      condition: symbol.replace(/_/g, " "),
      isDay: true,
      observedAt: series[0]?.time ?? new Date().toISOString(),
    },
    hourly: series.slice(0, 24).map((s) => ({
      time: s.time,
      temperatureC: s.data?.instant?.details?.air_temperature ?? null,
      precipProbPct: null,
      windSpeedKmh: s.data?.instant?.details?.wind_speed != null
        ? Math.round(s.data.instant.details.wind_speed * 3.6 * 10) / 10
        : null,
      condition: (s.data?.next_1_hours?.summary?.symbol_code ?? "variable").replace(/_/g, " "),
    })),
    daily: [],
    airQuality: null,
  };
}

function formatWeatherResponse(payload, { cached = false, fetchedAt = null, stale = false, location = null } = {}) {
  const resolvedFetchedAt =
    fetchedAt || payload.fetchedAt || payload.current?.observedAt || new Date().toISOString();
  const current = payload.current ?? {};
  const daily = Array.isArray(payload.daily) ? payload.daily : [];
  return {
    ...payload,
    source: payload.provider ?? payload.source ?? "open-meteo",
    location: location ?? payload.location ?? null,
    fetchedAt: resolvedFetchedAt,
    cached: Boolean(cached),
    _cached: Boolean(cached),
    stale: Boolean(stale),
    temperature: current.temperatureC ?? null,
    feelsLike: current.apparentTemperatureC ?? null,
    condition: current.condition ?? null,
    humidity: current.humidityPct ?? null,
    windSpeed: current.windSpeedKmh ?? null,
    windDirection: current.windDirectionDeg ?? null,
    pressure: current.pressureHpa ?? null,
    visibility: current.visibilityM ?? null,
    cloudCover: current.cloudCoverPct ?? null,
    precipitation: current.precipitationMm ?? null,
    forecast: daily.slice(0, 5).map((d) => ({
      date: d.date,
      condition: d.condition ?? null,
      tempMin: d.tempMinC ?? null,
      tempMax: d.tempMaxC ?? null,
      precipSum: d.precipSumMm ?? null,
      uvIndexMax: d.uvIndexMax ?? null,
      sunrise: d.sunrise ?? null,
      sunset: d.sunset ?? null,
    })),
  };
}

export async function getWeather(latOrOpts, maybeLon) {
  const opts =
    latOrOpts && typeof latOrOpts === "object"
      ? latOrOpts
      : { lat: latOrOpts, lon: maybeLon };
  const { lat, lon, location = null } = opts;
  if (!validateLatLon(lat, lon)) {
    const err = new Error("Coordinates must be finite with lat in [-90, 90] and lon in [-180, 180].");
    err.status = 400;
    err.code = "INVALID_COORDINATES";
    throw err;
  }
  const safeLat = Number(lat);
  const safeLon = Number(lon);

  const key = cacheKey(safeLat, safeLon);
  const cached = await readCache(key);
  if (cached) {
    return formatWeatherResponse(cached, { cached: true, location });
  }

  const preferred = (process.env.WEATHER_PROVIDER || "open-meteo").toLowerCase();
  let data;
  try {
    data = preferred === "met-norway"
      ? await fetchMetNorway(safeLat, safeLon)
      : await fetchOpenMeteo(safeLat, safeLon);
  } catch (primaryErr) {
    // Fallback to MET Norway if Open-Meteo fails
    if (preferred !== "met-norway") {
      try {
        data = await fetchMetNorway(safeLat, safeLon);
      } catch {
        throw primaryErr;
      }
    } else {
      throw primaryErr;
    }
  }

  const fetchedAt = new Date().toISOString();
  const stored = { ...data, fetchedAt };
  await writeCache(key, safeLat, safeLon, data.provider, stored);
  return formatWeatherResponse(stored, { cached: false, fetchedAt, location });
}
