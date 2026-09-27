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
    throw err;
  }
  return json;
}

export const api = {
  health: () => req("/api/health"),
  providers: () => req("/api/providers/health"),
  countries: () => req("/api/countries"),
  country: (id) => req(`/api/countries/${encodeURIComponent(id)}`),
  countryStates: (id) => req(`/api/countries/${encodeURIComponent(id)}/states`),
  countryCities: (id) => req(`/api/countries/${encodeURIComponent(id)}/cities`),
  capitals: () => req("/api/capitals"),
  search: (q, signal) => req(`/api/locations/search?q=${encodeURIComponent(q)}`, { signal }),
  nearby: (lat, lon, radiusKm) =>
    req(`/api/locations/nearby?lat=${lat}&lon=${lon}&radiusKm=${radiusKm ?? 100}`),
  reverse: (lat, lon) => req(`/api/locations/reverse?lat=${lat}&lon=${lon}`),
  weather: (lat, lon, signal) => req(`/api/weather?lat=${lat}&lon=${lon}`, { signal }),
  airports: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return req(`/api/airports${qs ? `?${qs}` : ""}`);
  },
  airport: (id) => req(`/api/airports/${encodeURIComponent(id)}`),
  airlines: () => req("/api/airlines"),
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
  requestEmailOtp: (email) => req("/api/auth/request-email-otp", { method: "POST", body: { email } }),
  verifyEmailOtp: (email, code, name) => req("/api/auth/verify-email-otp", { method: "POST", body: { email, code, name } }),
  requestPhoneOtp: (phone, countryCode) => req("/api/auth/request-phone-otp", { method: "POST", body: { phone, countryCode } }),
  verifyPhoneOtp: (phone, countryCode, code, name) => req("/api/auth/verify-phone-otp", { method: "POST", body: { phone, countryCode, code, name } }),
  logout: () => req("/api/auth/logout", { method: "POST" }),
  unlinkProvider: (provider) => req("/api/auth/unlink-provider", { method: "POST", body: { provider } }),
  savedList: () => req("/api/saved/locations"),
  savedAdd: (entry) => req("/api/saved/locations", { method: "POST", body: entry }),
  savedRemove: (id) => req(`/api/saved/locations/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
