import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AIRLINES, AIRPORTS, CITIES, COUNTRIES, POIS, STATES } from "./seed-data.js";

describe("seed catalog integrity (no fabricated coordinates)", () => {
  it("every city has finite WGS84 coordinates", () => {
    for (const [id, , , , lat, lon] of CITIES) {
      assert.ok(Number.isFinite(lat) && lat >= -90 && lat <= 90, `${id} lat`);
      assert.ok(Number.isFinite(lon) && lon >= -180 && lon <= 180, `${id} lon`);
      assert.ok(!(lat === 0 && lon === 0), `${id} is a null-island placeholder`);
    }
  });
  it("every airport has a 3-letter IATA, 4-letter ICAO and valid refs", () => {
    const cityIds = new Set(CITIES.map((c) => c[0]));
    const countryIds = new Set(COUNTRIES.map((c) => c.id));
    for (const [iata, icao, , cityId, countryId] of AIRPORTS) {
      assert.match(iata, /^[A-Z]{3}$/, `IATA ${iata}`);
      assert.match(icao, /^[A-Z]{4}$/, `ICAO ${icao}`);
      assert.ok(cityIds.has(cityId), `airport ${iata} city ref`);
      assert.ok(countryIds.has(countryId), `airport ${iata} country ref`);
    }
  });
  it("airline country refs exist", () => {
    const countryIds = new Set(COUNTRIES.map((c) => c.id));
    for (const [id, , , , countryId] of AIRLINES) {
      assert.ok(countryIds.has(countryId), `airline ${id}`);
    }
  });
  it("state country refs exist", () => {
    const countryIds = new Set(COUNTRIES.map((c) => c.id));
    for (const s of STATES) assert.ok(countryIds.has(s.countryId), `state ${s.id}`);
  });
  it("UNESCO designation appears only on an allow-list of listed sites", () => {
    const allowed = new Set([
      "Taj Mahal", "Machu Picchu", "Great Wall at Badaling", "Pyramids of Giza",
      "Statue of Liberty", "Sydney Opera House", "Colosseum", "Acropolis of Athens",
      "Sagarmatha (Mount Everest)", "Kinkaku-ji",
    ]);
    for (const [name, , designation] of POIS) {
      if (designation === "UNESCO") assert.ok(allowed.has(name), `UNESCO claim: ${name}`);
    }
  });
});
