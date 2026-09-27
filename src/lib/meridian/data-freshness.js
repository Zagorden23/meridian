// Data-freshness policy: every dynamic domain declares its TTLs in one place.
// Cached payloads always carry { fetchedAt, expiresAt, source }.
export const TTL = {
  weatherCurrentMs: 10 * 60 * 1000,
  weatherForecastMs: 3 * 60 * 60 * 1000,
  flightPositionMs: 45 * 1000,
  flightStatusMs: 2 * 60 * 1000,
  airportBoardMs: 5 * 60 * 1000,
  geoStaticMs: 30 * 24 * 60 * 60 * 1000, // countries/cities/airports metadata
  poiMs: 24 * 60 * 60 * 1000,
};

export function freshness(fetchedAt, ttlMs, now = Date.now()) {
  const age = now - Date.parse(fetchedAt);
  if (!Number.isFinite(age) || age < 0) return "UNKNOWN";
  if (age <= ttlMs) return "LIVE";
  if (age <= ttlMs * 4) return "RECENT";
  return "STALE";
}

export function withFreshness(payload, ttlMs) {
  return {
    ...payload,
    fetchedAt: payload.fetchedAt ?? new Date().toISOString(),
    expiresAt:
      payload.expiresAt ?? new Date(Date.now() + ttlMs).toISOString(),
    freshness: freshness(payload.fetchedAt ?? new Date().toISOString(), ttlMs),
  };
}

export function ageLabel(fetchedAt, now = Date.now()) {
  const age = now - Date.parse(fetchedAt);
  if (!Number.isFinite(age)) return "unknown age";
  const s = Math.max(0, Math.floor(age / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
