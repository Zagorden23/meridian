// Comprehensive Meridian functionality & error suite:
// GeoRepository (MongoDB + 2dsphere + seeding), WeatherService (cache + fallback + errors),
// FlightProviders (validation + 503 unavailability), AI Tools, and OIDC security.

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

function buildTestMongoUri() {
  const dbName = `meridian_api_test_${process.pid}_${Date.now()}`;
  const base = process.env.MONGODB_URI?.trim();
  if (base) {
    try {
      const u = new URL(base);
      u.pathname = `/${dbName}`;
      return u.toString();
    } catch {
      // fall through
    }
  }
  return `mongodb://127.0.0.1:27017/${dbName}`;
}

describe("Meridian MongoDB geo catalog, weather, flights, AI & security", () => {
  const prevMongo = process.env.MONGODB_URI;
  const testUri = buildTestMongoUri();

  before(async () => {
    process.env.MONGODB_URI = testUri;
    const { requireMongoConnection } = await import("./mongo.js");
    await requireMongoConnection();
  });

  after(async () => {
    const { connectMongo, disconnectMongo } = await import("./mongo.js");
    try {
      const conn = await connectMongo();
      if (conn?.connection?.db) {
        await conn.connection.db.dropDatabase();
      }
    } catch {
      // ignore cleanup error
    }
    await disconnectMongo().catch(() => {});
    if (prevMongo !== undefined) process.env.MONGODB_URI = prevMongo;
    else delete process.env.MONGODB_URI;
  });

  it("seeds curated geo catalog idempotently and supports all MongoDB spatial queries", async () => {
    const { seedCurated, logIngestion } = await import("./seed.js");
    const { IngestionLog, pingMongo } = await import("./mongo.js");
    const {
      listCountries,
      getCountry,
      getCountryStates,
      getCountryCities,
      searchCatalog,
      getCity,
      citiesInViewport,
      nearby,
      listAirports,
      getAirport,
      nearestAirport,
      listAirlines,
      getAirline,
      listCapitals,
      poisNearby,
      reverseGeocode,
    } = await import("./geo-repository.js");

    const ping = await pingMongo();
    assert.equal(ping.ok, true);
    assert.equal(ping.connected, true);

    const c1 = await seedCurated();
    const c2 = await seedCurated();
    assert.deepEqual(c1, c2);
    assert.ok(c1.countries >= 35);
    assert.ok(c1.cities >= 45);
    assert.ok(c1.airports >= 25);
    assert.ok(c1.airlines >= 10);
    assert.ok(c1.pois >= 10);

    await logIngestion("test-curated", "unit-test", c1.countries);
    const logs = await IngestionLog().countDocuments({ dataset: "test-curated" });
    assert.equal(logs, 1);

    const countries = await listCountries();
    assert.equal(countries.length, c1.countries);

    const jp = await getCountry("JP");
    assert.equal(jp?.id, "japan");
    assert.equal(await getCountry("JPN").then((x) => x?.id), "japan");
    assert.equal(await getCountry("does-not-exist"), null);
    assert.equal(await getCountry(""), null);

    const states = await getCountryStates("united-states");
    assert.ok(states.length >= 1);
    const inCities = await getCountryCities("india", 20);
    assert.ok(inCities.some((c) => c.id === "delhi" && c.countryId === "india"));

    const searchRes = await searchCatalog("Tokyo", { limit: 10 });
    assert.ok(Array.isArray(searchRes));
    assert.ok(searchRes.some((h) => h.kind === "CITY" && h.id === "tokyo" && h.countryName === "Japan"));
    assert.ok(searchRes.some((h) => h.kind === "AIRPORT" && h.iata === "HND"));

    // Empty & regex-metacharacter searches fail-safe cleanly without RegExp crashes
    const emptySearch = await searchCatalog("   ");
    assert.deepEqual(emptySearch, []);
    const weirdSearch = await searchCatalog("((*[tokyo]+?))\\");
    assert.ok(Array.isArray(weirdSearch));

    const tokyo = await getCity("tokyo");
    assert.equal(tokyo?.countryId, "japan");
    assert.equal(await getCity("nonexistent-city"), null);

    // Viewport query including Tokyo
    const vp = await citiesInViewport(34, 37, 138, 141, { limit: 20 });
    assert.ok(vp.some((c) => c.id === "tokyo"));

    // Antimeridian crossing viewport (170E to -170W encompasses Auckland/Fiji side 174.76E)
    const antimeridian = await citiesInViewport(-45, 45, 170, -150, { limit: 50 });
    assert.ok(antimeridian.some((c) => c.id === "auckland" || c.id === "honolulu"));

    // 2dsphere $geoNear queries
    const nearTokyo = await nearby(35.6762, 139.6503, 150, { limit: 5 });
    assert.equal(nearTokyo[0]?.id, "tokyo");
    assert.ok(typeof nearTokyo[0]?.distanceKm === "number" && nearTokyo[0].distanceKm < 1);

    const ap = await nearestAirport(35.6762, 139.6503);
    assert.equal(ap?.iata, "HND");
    assert.ok(ap?.distanceKm < 30);

    const apList = await listAirports({ countryId: "india" });
    assert.ok(apList.some((a) => a.iata === "DEL"));
    assert.equal((await getAirport("jfk"))?.id, "apt-jfk");
    assert.equal(await getAirport("ZZZ"), null);

    const airlines = await listAirlines();
    assert.ok(airlines.length >= 10);
    assert.ok(await getAirline("AI"));

    const capitals = await listCapitals();
    assert.ok(capitals.some((c) => c.id === "tokyo" && c.countryName === "Japan"));

    const pois = await poisNearby(35.6762, 139.6503, 80, { limit: 10 });
    assert.ok(Array.isArray(pois));

    const rev = await reverseGeocode(35.6762, 139.6503);
    assert.equal(rev.nearestCity?.id, "tokyo");
    assert.equal(rev.nearestAirport?.iata, "HND");
  });

  it("validates weather coords, caches snapshots in MongoDB, and fails cleanly on upstream outage", async () => {
    const { getWeather } = await import("./weather-service.js");
    const { WeatherSnapshot } = await import("./mongo.js");

    await assert.rejects(
      () => getWeather(91, 0),
      (err) => err?.status === 400 && err?.code === "INVALID_COORDINATES",
    );
    await assert.rejects(
      () => getWeather("not-a-num", 10),
      (err) => err?.status === 400 && err?.code === "INVALID_COORDINATES",
    );

    const origFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls++;
      if (String(url).includes("air-quality")) {
        return new Response(JSON.stringify({ current: { us_aqi: 22, pm2_5: 5.1, pm10: 9.2 } }), { status: 200 });
      }
      if (String(url).includes("open-meteo")) {
        return new Response(
          JSON.stringify({
            latitude: 48.85,
            longitude: 2.35,
            timezone: "Europe/Paris",
            elevation: 35,
            current: { temperature_2m: 18.5, relative_humidity_2m: 55, weather_code: 1, wind_speed_10m: 12, is_day: 1 },
            hourly: { time: ["2026-11-13T12:00"], temperature_2m: [18.5], precipitation_probability: [10], weather_code: [1], wind_speed_10m: [12] },
            daily: { time: ["2026-11-13"], temperature_2m_max: [20], temperature_2m_min: [11], precipitation_sum: [0], uv_index_max: [3], weather_code: [1] },
          }),
          { status: 200 },
        );
      }
      return new Response("upstream error", { status: 503 });
    };

    try {
      const w1 = await getWeather(48.85, 2.35);
      assert.equal(w1.provider, "open-meteo");
      assert.equal(w1.current.temperatureC, 18.5);
      assert.equal(w1._cached, false);

      // Persisted into MongoDB WeatherSnapshot
      const snapCount = await WeatherSnapshot().countDocuments({ key: "wx:48.85,2.35" });
      assert.equal(snapCount, 1);

      // Second read hits cache
      const beforeCalls = calls;
      const w2 = await getWeather(48.85, 2.35);
      assert.equal(w2._cached, true);
      assert.equal(calls, beforeCalls);

      // Double upstream failure on uncached point throws WEATHER_UPSTREAM_ERROR (502)
      globalThis.fetch = async () => new Response("down", { status: 503 });
      await assert.rejects(
        () => getWeather(-12.04, -77.04),
        (err) => err?.status === 502 && err?.code === "WEATHER_UPSTREAM_ERROR",
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("enforces flight validation & 503 unconfigured honesty and grounded AI tools", async () => {
    const { searchFlights, getFlightStatus, getAirportBoard, providerCoverage } = await import("./flight-providers.js");
    const { runTool, interpret } = await import("./ai-tools.js");

    await assert.rejects(
      () => searchFlights({ originAirport: "JFK", destinationAirport: "JFK" }),
      (err) => err?.status === 400 && err?.code === "SAME_AIRPORT",
    );
    await assert.rejects(
      () => searchFlights({ originAirport: "JFK", destinationAirport: "HND", departureDate: "2026-12-01" }),
      (err) => err?.status === 503 && err?.code === "PROVIDER_UNAVAILABLE",
    );
    await assert.rejects(
      () => getFlightStatus("!!"),
      (err) => err?.status === 400 && err?.code === "INVALID_FLIGHT_NUMBER",
    );
    await assert.rejects(
      () => getAirportBoard("JFK", "departures"),
      (err) => err?.status === 503,
    );
    assert.equal(providerCoverage().scheduleSearch.available, false);
    assert.equal(providerCoverage().livePositions.available, true);

    // AI tool whitelist + validation + live MongoDB catalog lookup
    await assert.rejects(
      () => runTool("dropCollection", {}),
      (err) => err?.status === 403 && err?.code === "TOOL_FORBIDDEN",
    );

    const apToolRes = await runTool("findNearestAirport", { lat: 35.6762, lon: 139.6503 });
    assert.equal(apToolRes?.iata, "HND");

    const chatRes = await interpret("Nearest airport to Tokyo", {
      location: { lat: 35.6762, lon: 139.6503, name: "Tokyo" },
    });
    assert.ok(chatRes.reply.includes("HND"));
    assert.equal(chatRes.tools[0]?.name, "findNearestAirport");
  });

  it("validates returnTo open-redirect protection and 503 MONGO_UNCONFIGURED on geo calls", async () => {
    const { safeReturnTo } = await import("./return-to.js");
    const { disconnectMongo, requireMongoConnection } = await import("./mongo.js");
    const { listCountries } = await import("./geo-repository.js");

    assert.equal(safeReturnTo("/app?module=weather"), "/app?module=weather");
    assert.equal(safeReturnTo("https://evil.example/phish"), "/app");
    assert.equal(safeReturnTo("//evil.example"), "/app");
    assert.equal(safeReturnTo("javascript:alert(1)"), "/app");

    const saved = process.env.MONGODB_URI;
    try {
      delete process.env.MONGODB_URI;
      await disconnectMongo();
      await assert.rejects(
        () => listCountries(),
        (err) => err?.status === 503 && err?.code === "MONGO_UNCONFIGURED",
      );
    } finally {
      process.env.MONGODB_URI = saved;
      await requireMongoConnection();
    }
  });
});
