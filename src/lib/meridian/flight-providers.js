// FlightProvider abstraction. The UI only speaks the normalized models below.
// Coverage is provider-limited and represented honestly: schedule/status search
// requires a licensed API key (FLIGHT_API_KEY); live positions use the keyless
// OpenSky network API where coverage exists. Anything unavailable returns a
// typed "unavailable" result — never invented flights.
//
// Normalized status: SCHEDULED CHECK_IN BOARDING DELAYED DEPARTED EN_ROUTE
// LANDED CANCELLED DIVERTED RETURNED UNKNOWN
import { TTL } from "./data-freshness.js";

export const FLIGHT_STATUS = [
  "SCHEDULED", "CHECK_IN", "BOARDING", "DELAYED", "DEPARTED", "EN_ROUTE",
  "LANDED", "CANCELLED", "DIVERTED", "RETURNED", "UNKNOWN",
];

export function unavailable(feature, reason) {
  const err = new Error(reason);
  err.status = 503;
  err.code = "PROVIDER_UNAVAILABLE";
  err.feature = feature;
  return err;
}

// --- Provider coverage registry ---------------------------------------------
// Schedule search, flight status and airport boards need a licensed data
// provider, and no adapter for one ships yet (see searchFlights below). Until
// one does, those features are reported as unavailable even when
// FLIGHT_API_KEY is set: a key by itself connects nothing, and claiming
// "available" for a feature whose every call fails would be a false status.
const LICENSED_ADAPTER_READY = false;

function licensedCoverage(feature) {
  const key = process.env.FLIGHT_API_KEY;
  if (LICENSED_ADAPTER_READY && key) {
    return { available: true, provider: "licensed-schedule", note: "Coverage per provider contract." };
  }
  return {
    available: false,
    provider: null,
    note: key
      ? `FLIGHT_API_KEY is set, but no ${feature} provider adapter is implemented yet.`
      : `No ${feature} provider configured. Set FLIGHT_API_KEY.`,
  };
}

export function providerCoverage() {
  const openskyUser = process.env.OPENSKY_CLIENT_ID;
  return {
    scheduleSearch: licensedCoverage("flight-search"),
    flightStatus: licensedCoverage("status"),
    livePositions: {
      available: true,
      provider: "opensky",
      authenticated: Boolean(openskyUser),
      note: "OpenSky community coverage: mainly ADS-B equipped airspace (Europe, North America). No universal tracking claimed.",
    },
    airportBoards: licensedCoverage("board"),
    pnrLookup: { available: false, provider: null, note: "PNR lookup requires an airline/GDS integration. Not configured." },
  };
}

// --- OpenSky live positions (keyless, anonymous rate limits apply) -----------
const OPENSKY_STATES = "https://opensky-network.org/api/states/all";

export async function getLiveTraffic({ lamin, lamax, lomin, lomax } = {}) {
  const params = new URLSearchParams();
  if ([lamin, lamax, lomin, lomax].every(Number.isFinite)) {
    params.set("lamin", lamin);
    params.set("lamax", lamax);
    params.set("lomin", lomin);
    params.set("lomax", lomax);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const headers = { accept: "application/json" };
    if (process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET) {
      const token = await openskyToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${OPENSKY_STATES}?${params}`, { signal: ctrl.signal, headers });
    if (res.status === 429) throw unavailable("livePositions", "Live traffic rate limit reached. Retry shortly.");
    if (!res.ok) throw new Error(`OpenSky responded ${res.status}`);
    const json = await res.json();
    const fetchedAt = new Date().toISOString();
    const aircraft = (json.states ?? []).slice(0, 800).map((s) => normalizeState(s, fetchedAt)).filter(Boolean);
    return { aircraft, fetchedAt, source: "opensky", freshness: "LIVE" };
  } finally {
    clearTimeout(timer);
  }
}

let openskyTokenCache = null;
async function openskyToken() {
  if (openskyTokenCache && openskyTokenCache.expiresAt > Date.now()) return openskyTokenCache.token;
  try {
    const res = await fetch("https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.OPENSKY_CLIENT_ID,
        client_secret: process.env.OPENSKY_CLIENT_SECRET,
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    openskyTokenCache = { token: j.access_token, expiresAt: Date.now() + (j.expires_in - 60) * 1000 };
    return openskyTokenCache.token;
  } catch {
    return null;
  }
}

// OpenSky state vector → normalized position. Missing fields stay null.
function normalizeState(s, fetchedAt) {
  if (!Array.isArray(s) || s[5] == null || s[6] == null) return null;
  const lastContact = s[4] ? new Date(s[4] * 1000).toISOString() : null;
  return {
    flightId: s[0] ?? s[1] ?? null,
    flightNumber: null,
    callsign: (s[1] ?? "").trim() || null,
    aircraftRegistration: null,
    latitude: s[6],
    longitude: s[5],
    altitude: s[7] ?? s[13] ?? null,
    groundspeed: s[9] ?? null,
    heading: s[10] ?? null,
    verticalRate: s[11] ?? null,
    timestamp: lastContact,
    source: "opensky",
    positionAge: lastContact ? Math.max(0, Date.now() - Date.parse(lastContact)) : null,
    onGround: s[8] ?? null,
    fetchedAt,
    freshness: "LIVE",
  };
}

// --- Flight number parsing ----------------------------------------------------
export function parseFlightNumber(input) {
  const raw = String(input ?? "").toUpperCase().replace(/[\s-]+/g, "");
  const m = raw.match(/^([A-Z0-9]{2})(\d{1,4}[A-Z]?)$/);
  if (!m) {
    throw Object.assign(new Error("Unrecognized flight number. Try formats like 6E 521 or AI 473."), {
      status: 400, code: "INVALID_FLIGHT_NUMBER",
    });
  }
  return { airlineCode: m[1], number: m[2], normalized: `${m[1]} ${m[2]}` };
}

// --- Licensed-provider stubs (honest: require FLIGHT_API_KEY) ----------------
// Wire a real schedule API here (e.g. Aviationstack/Cirium/AeroDataBox) by
// implementing searchFlights/getFlightStatus against its docs and normalizing
// into the shapes below. Until then every call explains itself.
export async function searchFlights(params) {
  validateFlightSearch(params);
  if (!process.env.FLIGHT_API_KEY) {
    throw unavailable("searchFlights", "Flight search is unavailable: no flight-search provider is configured (FLIGHT_API_KEY).");
  }
  throw unavailable("searchFlights", "Flight-search provider adapter is not implemented for the configured key.");
}

export async function getFlightStatus(flightNumber) {
  parseFlightNumber(flightNumber);
  if (!process.env.FLIGHT_API_KEY) {
    throw unavailable("getFlightStatus", "Flight status is unavailable: no status provider is configured (FLIGHT_API_KEY).");
  }
  throw unavailable("getFlightStatus", "Status adapter is not implemented for the configured key.");
}

export async function getAirportBoard() {
  if (!process.env.FLIGHT_API_KEY) {
    throw unavailable("getAirportBoard", "Airport boards are unavailable: no board provider is configured (FLIGHT_API_KEY).");
  }
  throw unavailable("getAirportBoard", "Board adapter is not implemented for the configured key.");
}

export function validateFlightSearch(p = {}) {
  const { tripType, originAirport, destinationAirport, departureDate, passengers } = p;
  if (!originAirport || !destinationAirport) {
    throw Object.assign(new Error("Origin and destination airports are required."), { status: 400, code: "INVALID_ROUTE" });
  }
  if (String(originAirport).toUpperCase() === String(destinationAirport).toUpperCase()) {
    throw Object.assign(new Error("Origin and destination must differ."), { status: 400, code: "SAME_AIRPORT" });
  }
  if (tripType === "domestic" && p.originCountry && p.destinationCountry &&
      p.originCountry !== p.destinationCountry) {
    throw Object.assign(new Error("Domestic flights require origin and destination in the same country."), {
      status: 400, code: "DOMESTIC_COUNTRY_MISMATCH",
    });
  }
  if (tripType === "international" && p.originCountry && p.destinationCountry &&
      p.originCountry === p.destinationCountry) {
    throw Object.assign(new Error("International flights require different origin and destination countries."), {
      status: 400, code: "INTERNATIONAL_SAME_COUNTRY",
    });
  }
  if (departureDate && Number.isNaN(Date.parse(departureDate))) {
    throw Object.assign(new Error("Invalid departure date."), { status: 400, code: "INVALID_DATE" });
  }
  if (passengers != null && (passengers < 1 || passengers > 9)) {
    throw Object.assign(new Error("Passengers must be between 1 and 9."), { status: 400, code: "INVALID_PASSENGERS" });
  }
  return true;
}

export { TTL };
