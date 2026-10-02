// GeocodingService — worldwide forward geocoding beyond the local catalog.
// Provider: Open-Meteo Geocoding (keyless, real GeoNames data). The UI never
// calls providers directly; results are normalized into MERIDIAN's hit shape
// and tagged with their source. Nothing is fabricated: a miss is a miss.
// Cache: in-process TTL (provider results for the same query are stable).
import { normalizeName } from "./geo-math.js";

const PROVIDER = "open-meteo";
const SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";
const TTL_MS = 6 * 60 * 60 * 1000; // place metadata is stable for hours

const memCache = new Map(); // query → { results, expiresAt }

export function normalizeHit(h) {
  const lat = h.latitude;
  const lon = h.longitude;
  if (lat == null || lon == null) return null;
  return {
    kind: "PLACE",
    id: `geonames:${h.id}`,
    name: h.name,
    countryId: h.country_code ?? null,
    countryName: h.country ?? null,
    region: h.admin1 ?? null,
    latitude: lat,
    longitude: lon,
    timezone: h.timezone ?? null,
    population: h.population ?? null,
    elevation: h.elevation ?? null,
    source: PROVIDER,
  };
}

export async function forwardGeocode(query, { signal } = {}) {
  const q = String(query ?? "").trim();
  if (q.length < 2) return [];
  const key = normalizeName(q);
  if (!key) return [];

  const mem = memCache.get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.results;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  // Propagate caller aborts into our own controller.
  signal?.addEventListener("abort", () => ctrl.abort(), { once: true });
  try {
    const url = `${SEARCH_URL}?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Geocoding provider responded ${res.status}`);
    const json = await res.json();
    const results = (Array.isArray(json.results) ? json.results : [])
      .map(normalizeHit)
      .filter(Boolean);
    memCache.set(key, { results, expiresAt: Date.now() + TTL_MS });
    // Opportunistic pruning so long-running processes stay bounded.
    if (memCache.size > 500) {
      const now = Date.now();
      for (const [k, v] of memCache) if (v.expiresAt <= now) memCache.delete(k);
    }
    return results;
  } finally {
    clearTimeout(timer);
  }
}

// Search-catalog orchestration: local catalog first (authoritative for
// airports/cities we seeded), online geocoder fills worldwide gaps. Used by
// /api/locations/search so the frontend never knows a provider exists.
export async function unifiedSearch(query, { localSearch, limit = 12 } = {}) {
  const q = String(query ?? "").trim();
  const local = await localSearch(q, { limit });
  // Fill toward `limit` when the local catalog misses (small places worldwide).
  if (local.length >= limit) return local;
  try {
    const online = await forwardGeocode(q);
    const seen = new Set(local.map((r) => normalizeName(r.name) + "|" + (r.countryId ?? r.country_id ?? "")));
    const merged = [...local];
    for (const hit of online) {
      const k = normalizeName(hit.name) + "|" + (hit.countryId ?? "");
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(hit);
      if (merged.length >= limit) break;
    }
    return merged;
  } catch {
    // Provider down ≠ broken search: local catalog results still flow.
    return local;
  }
}
