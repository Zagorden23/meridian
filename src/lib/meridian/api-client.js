// Client fetch wrappers for /api/*. Same-origin; no keys in the browser.
async function req(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(path, {
    method,
    signal,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.success === false) {
    const err = new Error(json?.error?.message ?? `Request failed (${res.status})`);
    err.code = json?.error?.code ?? "REQUEST_FAILED";
    err.status = res.status;
    if (json?.error?.details) err.details = json.error.details;
    throw err;
  }
  return json;
}

// Several panels ask for the same catalog data (countries, airports, the
// weather of the selected place). Identical reads share one request and a short
// cache instead of each panel hitting the network; a failed read is forgotten
// so the next caller retries.
const shared = new Map();
function cached(path, ttlMs) {
  const hit = shared.get(path);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = req(path).catch((err) => {
    shared.delete(path);
    throw err;
  });
  if (shared.size >= 200) {
    // Bounded: drop what has expired, then the oldest entry if still full.
    const now = Date.now();
    for (const [key, entry] of shared) if (entry.expires <= now) shared.delete(key);
    if (shared.size >= 200) shared.delete(shared.keys().next().value);
  }
  shared.set(path, { promise, expires: Date.now() + ttlMs });
  return promise;
}
const CATALOG_TTL = 5 * 60 * 1000;
const WEATHER_TTL = 60 * 1000;

export const api = {
  health: () => req("/api/health"),
  providers: () => req("/api/providers/health"),
  countries: () => cached("/api/countries", CATALOG_TTL),
  country: (id) => req(`/api/countries/${encodeURIComponent(id)}`),
  countryStates: (id) => req(`/api/countries/${encodeURIComponent(id)}/states`),
  countryCities: (id) => req(`/api/countries/${encodeURIComponent(id)}/cities`),
  capitals: () => cached("/api/capitals", CATALOG_TTL),
  search: (q, signal) => req(`/api/locations/search?q=${encodeURIComponent(q)}`, { signal }),
  nearby: (lat, lon, radiusKm) =>
    req(`/api/locations/nearby?lat=${lat}&lon=${lon}&radiusKm=${radiusKm ?? 100}`),
  reverse: (lat, lon) => req(`/api/locations/reverse?lat=${lat}&lon=${lon}`),
  weather: (lat, lon) => cached(`/api/weather?lat=${lat}&lon=${lon}`, WEATHER_TTL),
  airports: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return cached(`/api/airports${qs ? `?${qs}` : ""}`, CATALOG_TTL);
  },
  airport: (id) => req(`/api/airports/${encodeURIComponent(id)}`),
  airlines: () => cached("/api/airlines", CATALOG_TTL),
  airline: (id) => req(`/api/airlines/${encodeURIComponent(id)}`),
  timezone: (lat, lon, tz) =>
    req(`/api/timezone?lat=${lat}&lon=${lon}${tz ? `&tz=${encodeURIComponent(tz)}` : ""}`),
  flightsSearch: (payload) => req("/api/flights/search", { method: "POST", body: payload }),
  flightStatus: (num) => req(`/api/flights/status?number=${encodeURIComponent(num)}`),
  liveTraffic: (bbox) => {
    const qs = bbox ? `?${new URLSearchParams(bbox).toString()}` : "";
    return req(`/api/flights/live${qs}`);
  },
  aiChat: (message, context) => req("/api/ai/chat", { method: "POST", body: { message, context } }),
  session: () => req("/api/auth/session"),
  authProviders: () => req("/api/auth/providers"),
  signupPassword: (email, password, name) => req("/api/auth/signup-password", { method: "POST", body: { email, password, name } }),
  signinPassword: (email, password) => req("/api/auth/signin-password", { method: "POST", body: { email, password } }),
  forgotPassword: (email) => req("/api/auth/forgot-password", { method: "POST", body: { email } }),
  resetPassword: (email, code, newPassword) => req("/api/auth/reset-password", { method: "POST", body: { email, code, newPassword } }),
  requestEmailOtp: (email, purpose) => req("/api/auth/request-email-otp", { method: "POST", body: { email, ...(purpose ? { purpose } : {}) } }),
  verifyEmailOtp: (email, code, name, purpose) => req("/api/auth/verify-email-otp", { method: "POST", body: { email, code, name, ...(purpose ? { purpose } : {}) } }),
  requestPhoneOtp: (phone, countryCode, purpose) => req("/api/auth/request-phone-otp", { method: "POST", body: { phone, countryCode, ...(purpose ? { purpose } : {}) } }),
  verifyPhoneOtp: (phone, countryCode, code, name) => req("/api/auth/verify-phone-otp", { method: "POST", body: { phone, countryCode, code, name } }),
  linkEmail: (email, code) => req("/api/auth/link-email", { method: "POST", body: { email, code } }),
  linkPhone: (phone, countryCode, code) => req("/api/auth/link-phone", { method: "POST", body: { phone, countryCode, code } }),
  setPassword: (currentPassword, newPassword) => req("/api/auth/password", { method: "POST", body: { currentPassword, newPassword } }),
  revokeSessions: () => req("/api/auth/revoke-sessions", { method: "POST" }),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  unlinkProvider: (provider) => req("/api/auth/unlink-provider", { method: "POST", body: { provider } }),
  savedList: () => req("/api/saved/locations"),
  savedAdd: (entry) => req("/api/saved/locations", { method: "POST", body: entry }),
  savedRemove: (id) => req(`/api/saved/locations/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
