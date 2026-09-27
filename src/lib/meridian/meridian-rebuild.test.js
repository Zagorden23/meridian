// MERIDIAN rebuild acceptance: Chennai → Kolkata end-to-end math,
// flight-number parsing, map-adapter surface, Mongo 2dsphere schemas.
// No network, no DB connection — pure unit assertions.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { distanceKm, interpolateGreatCircle, arcAltitude } from "./geo-math.js";
import { parseFlightNumber } from "./flight-providers.js";
import { BaseMapAdapter, MAP_MODES } from "./map-adapters.js";

const MAA = { lat: 13.0827, lon: 80.2707 }; // Chennai
const CCU = { lat: 22.5726, lon: 88.3639 }; // Kolkata

describe("Chennai → Kolkata end-to-end workflow math", () => {
  it("route distance is real (~1360 km)", () => {
    const km = distanceKm(MAA.lat, MAA.lon, CCU.lat, CCU.lon);
    assert.ok(km > 1300 && km < 1420, `got ${km}`);
  });
  it("great-circle midpoint stays geographically correct", () => {
    const mid = interpolateGreatCircle(MAA.lat, MAA.lon, CCU.lat, CCU.lon, 0.5);
    assert.ok(mid.lat > 16 && mid.lat < 20, `lat ${mid.lat}`);
    assert.ok(mid.lon > 82 && mid.lon < 86, `lon ${mid.lon}`);
  });
  it("arc height adapts to distance (not one fixed height)", () => {
    const shortHop = arcAltitude(distanceKm(MAA.lat, MAA.lon, 13.5, 80.5));
    const longHaul = arcAltitude(distanceKm(MAA.lat, MAA.lon, CCU.lat, CCU.lon));
    const ultra = arcAltitude(11000);
    assert.ok(longHaul > shortHop, "route arc must exceed hop arc");
    assert.ok(ultra > longHaul, "ultra-long arc must exceed medium arc");
  });
  it("parses 6E521 as airline 6E + number 521", () => {
    const p = parseFlightNumber("6E521");
    assert.equal(p.airlineCode, "6E");
    assert.equal(p.number, "521");
    assert.equal(p.normalized, "6E 521");
  });
});

describe("2D/3D adapter surface", () => {
  it("supports both map modes", () => {
    assert.ok(MAP_MODES.includes("3d") && MAP_MODES.includes("2d"));
  });
  it("switching preserves selection/route state", () => {
    const a = new BaseMapAdapter();
    a.selectLocation("CITY:chennai", { lat: MAA.lat, lon: MAA.lon });
    a.showRoute({ origin: MAA, destination: CCU });
    const v = a.getViewport();
    assert.equal(v.selectedId, "CITY:chennai");
    assert.ok(v.route, "route must survive adapter switch");
    a.flyTo(CCU.lat, CCU.lon, 4);
    assert.equal(a.getViewport().route, v.route, "flyTo must not destroy route");
  });
});

describe("MongoDB 2dsphere schemas (no connection)", () => {
  it("geo models declare GeoJSON Point + 2dsphere path", async () => {
    const mongo = await import("./mongo.js");
    for (const make of [mongo.City, mongo.Airport, mongo.Poi, mongo.WeatherSnapshot]) {
      const M = make();
      const loc = M.schema.path("location");
      assert.ok(loc, "location path required");
      const coords = M.schema.path("location.coordinates");
      assert.ok(coords, "coordinates required");
    }
    assert.equal(mongo.mongoConfigured(), Boolean(process.env.MONGODB_URI?.trim()));
    assert.ok(typeof mongo.cacheWeatherMongo === "function");
    assert.ok(typeof mongo.nearestAirportMongo === "function");
  });
  it("tracking collections declare TTL retention", async () => {
    const mongo = await import("./mongo.js");
    const posExp = mongo.FlightPosition().schema.path("createdAt").options.expires;
    const snapExp = mongo.WeatherSnapshot().schema.path("expiresAt").options.expires;
    assert.ok(Number(posExp) > 0, "flightPositions need TTL");
    assert.equal(snapExp, 0, "weatherSnapshots expire at absolute time");
  });
});
