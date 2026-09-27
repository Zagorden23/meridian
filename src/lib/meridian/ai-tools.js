// MERIDIAN AI — structured tools only. The assistant NEVER executes arbitrary
// JS/SQL/shell and NEVER invents live data: every live fact comes from a
// whitelisted tool below that hits the backend services. Rule-based intent
// parsing ships keyless; an LLM backend (XAI_API_KEY) can replace interpret()
// later while keeping the same tool surface and validators.
import {
  getAirport, getCity, getCountry, listAirlines, nearestAirport, nearby,
  reverseGeocode, searchCatalog,
} from "./geo-repository.js";
import { getWeather } from "./weather-service.js";
import { getLiveTraffic, parseFlightNumber, providerCoverage } from "./flight-providers.js";
import { distanceKm, validateLatLon } from "./geo-math.js";

// Whitelisted tool surface (mirrors the spec's tool list).
export const AI_TOOLS = [
  "searchLocations", "getLocation", "getWeather", "getNearbyPlaces", "getAirports",
  "getAirlines", "searchFlights", "calculateDistance", "calculateRoute", "getTimezone",
  "navigateGlobe", "switchMapMode", "selectCountry", "selectCity", "trackFlight",
  "getFlightStatus", "getFlightPosition", "findNearestAirport", "useDeviceLocation",
];

function validatedCoords(args) {
  const lat = Number(args?.lat);
  const lon = Number(args?.lon);
  if (!validateLatLon(lat, lon)) throw Object.assign(new Error("Invalid coordinates."), { status: 400, code: "INVALID_COORDS" });
  return { lat, lon };
}

export async function runTool(name, args = {}) {
  if (!AI_TOOLS.includes(name)) {
    throw Object.assign(new Error(`Tool not allowed: ${name}`), { status: 403, code: "TOOL_FORBIDDEN" });
  }
  switch (name) {
    case "searchLocations": {
      const q = String(args.query ?? "").slice(0, 120);
      if (!q) throw Object.assign(new Error("Query is required."), { status: 400, code: "INVALID_QUERY" });
      return searchCatalog(q, { limit: 8 });
    }
    case "getLocation": {
      const city = await getCity(String(args.id ?? ""));
      if (!city) throw Object.assign(new Error("Location not found."), { status: 404, code: "NOT_FOUND" });
      return city;
    }
    case "getWeather": {
      const { lat, lon } = validatedCoords(args);
      return getWeather({ lat, lon, location: args.location ?? null });
    }
    case "getNearbyPlaces": {
      const { lat, lon } = validatedCoords(args);
      return nearby(lat, lon, Math.min(Number(args.radiusKm) || 100, 500), { limit: 10 });
    }
    case "getAirports": {
      if (args.nearest) {
        const { lat, lon } = validatedCoords(args);
        return nearestAirport(lat, lon);
      }
      return getAirport(String(args.id ?? args.code ?? ""));
    }
    case "findNearestAirport": {
      const { lat, lon } = validatedCoords(args);
      const ap = await nearestAirport(lat, lon);
      if (!ap) return { found: false, message: "No catalogued airport within 500 km." };
      return { found: true, ...ap };
    }
    case "getAirlines":
      return listAirlines();
    case "calculateDistance": {
      const a = validatedCoords({ lat: args.fromLat, lon: args.fromLon });
      const b = validatedCoords({ lat: args.toLat, lon: args.toLon });
      return { km: Math.round(distanceKm(a.lat, a.lon, b.lat, b.lon) * 10) / 10, unit: "km" };
    }
    case "calculateRoute": {
      const a = validatedCoords({ lat: args.fromLat, lon: args.fromLon });
      const b = validatedCoords({ lat: args.toLat, lon: args.toLon });
      const { interpolateGreatCircle } = await import("./geo-math.js");
      const points = Array.from({ length: 25 }, (_, i) => interpolateGreatCircle(a.lat, a.lon, b.lat, b.lon, i / 24));
      return { points, distanceKm: distanceKm(a.lat, a.lon, b.lat, b.lon) };
    }
    case "getTimezone": {
      const { localTime, utcOffsetMinutes, formatOffset } = await import("./timezone.js");
      const tz = String(args.timezone ?? "");
      if (!tz) throw Object.assign(new Error("Timezone is required."), { status: 400, code: "INVALID_TZ" });
      const off = utcOffsetMinutes(tz);
      return { timezone: tz, localTime: localTime(tz), utcOffset: formatOffset(off) };
    }
    case "getFlightStatus": {
      const { normalized } = parseFlightNumber(args.flightNumber);
      return { flightNumber: normalized, status: "UNKNOWN", note: "Status provider not configured. See /api/providers/health." };
    }
    case "getFlightPosition":
    case "trackFlight": {
      const traffic = await getLiveTraffic(
        args.viewport ?? { lamin: -90, lamax: 90, lomin: -180, lomax: 180 },
      );
      const match = (traffic.aircraft ?? []).find((a) =>
        (a.callsign ?? "").replace(/\s/g, "") === String(args.flightNumber ?? "").toUpperCase().replace(/[\s-]/g, ""),
      );
      if (!match) return { tracked: false, note: "No live position for this flight in current coverage." };
      return { tracked: true, ...match };
    }
    // Navigation actions return intents for the client to execute (whitelisted).
    case "navigateGlobe":
    case "selectCountry":
    case "selectCity":
    case "switchMapMode":
    case "useDeviceLocation":
      return { action: name, args, note: "Client executes this whitelisted navigation." };
    case "searchFlights":
      return { note: "Flight search requires a configured provider.", coverage: providerCoverage().scheduleSearch };
    default:
      throw Object.assign(new Error(`Tool has no implementation: ${name}`), { status: 500, code: "TOOL_UNIMPLEMENTED" });
  }
}

// Minimal intent interpreter: maps natural language to tool calls + client actions.
export async function interpret(message, context = {}) {
  const text = String(message ?? "");
  const lower = text.toLowerCase();

  const trackMatch = text.match(/\btrack\s+([a-z0-9]{2}\s?-?\s?\d{1,4}[a-z]?)/i);
  if (trackMatch) {
    try {
      const { normalized } = parseFlightNumber(trackMatch[1]);
      const position = await runTool("trackFlight", { flightNumber: normalized, viewport: context.viewport });
      return {
        reply: position.tracked
          ? `Tracking ${normalized} at ${position.latitude.toFixed(2)}°, ${position.longitude.toFixed(2)}°.`
          : `${normalized} has no live position in current coverage.`,
        tools: [{ name: "trackFlight", result: position }],
        actions: position.tracked ? [{ action: "trackFlight", flightNumber: normalized, position }] : [],
      };
    } catch {
      return { reply: "I couldn't parse that flight number. Try formats like 6E 521 or AI 473.", tools: [], actions: [] };
    }
  }

  if (/nearest airport|closest airport/.test(lower) && context.location) {
    const result = await runTool("findNearestAirport", context.location);
    return {
      reply: result.found
        ? `Nearest airport is ${result.name} (${result.iata})${result.distanceKm != null ? `, ${result.distanceKm.toFixed(0)} km away` : ""}.`
        : "No catalogued airport within 500 km.",
      tools: [{ name: "findNearestAirport", result }],
      actions: result.found ? [{ action: "navigateGlobe", lat: result.latitude, lon: result.longitude }] : [],
    };
  }

  if (/weather/.test(lower)) {
    const m = text.match(/in\s+([a-z\s'.-]+)/i);
    const q = (m?.[1] ?? context.locationName ?? "").trim();
    if (q) {
      const hits = await runTool("searchLocations", { query: q });
      const city = hits.find((h) => h.kind === "CITY");
      if (city) {
        const wx = await runTool("getWeather", { lat: city.latitude, lon: city.longitude, location: city.name });
        return {
          reply: `${city.name}: ${wx.condition ?? "conditions unavailable"}, ${wx.temperature ?? "?"}°C (feels ${wx.feelsLike ?? "?"}°C). Updated ${wx.fetchedAt}.`,
          tools: [{ name: "getWeather", result: wx }],
          actions: [{ action: "navigateGlobe", lat: city.latitude, lon: city.longitude }],
        };
      }
    }
    return { reply: "Tell me a city and I'll fetch its weather through the backend service.", tools: [], actions: [] };
  }

  if (/flight|fly from|chennai to|delhi to|\(.*to.*\)/.test(lower) && /to/.test(lower)) {
    return {
      reply: "I can plan that route. Open Travel to pick origin, destination and date — I'll draw the great-circle arc on the globe. Live schedules need a configured flight provider.",
      tools: [],
      actions: [{ action: "openTravel" }],
    };
  }

  // Default: location search → navigate.
  const cleaned = text.replace(/^(show|go to|find|where is|take me to)\s+/i, "").trim();
  if (cleaned.length >= 2) {
    const hits = await runTool("searchLocations", { query: cleaned }).catch(() => []);
    const top = hits[0];
    if (top && (top.latitude != null || top.lat != null)) {
      const lat = top.latitude ?? top.lat;
      const lon = top.longitude ?? top.lon;
      return {
        reply: `${top.name} found. Flying the globe there.`,
        tools: [{ name: "searchLocations", result: hits }],
        actions: [{ action: "navigateGlobe", lat, lon, id: top.id, kind: top.kind }],
      };
    }
    if (top) {
      return { reply: `${top.name} found in the catalog.`, tools: [{ name: "searchLocations", result: hits }], actions: [] };
    }
  }
  if (context.locationName) {
    const rev = await reverseGeocode(context.location.lat, context.location.lon).catch(() => null);
    void rev;
  }
  void getCountry;
  return {
    reply: "Try “weather in Tokyo”, “track 6E 521”, “nearest airport”, or a place name like “Kyoto”.",
    tools: [],
    actions: [],
  };
}
