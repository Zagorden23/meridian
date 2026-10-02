import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCoordinateQuery } from "./geo-math.js";
import { normalizeHit } from "./geocoding-service.js";

test("coordinate query: plain decimal pair", () => {
  assert.deepEqual(parseCoordinateQuery("28.6139,77.2090"), {
    lat: 28.6139, lon: 77.209, format: "DECIMAL",
  });
});

test("coordinate query: space separated", () => {
  assert.deepEqual(parseCoordinateQuery("28.6139 77.2090"), {
    lat: 28.6139, lon: 77.209, format: "DECIMAL",
  });
});

test("coordinate query: DMS with hemispheres", () => {
  const r = parseCoordinateQuery("28°36'51\"N 77°12'32\"E");
  assert.ok(r);
  assert.equal(r.format, "DMS");
  assert.ok(Math.abs(r.lat - 28.6142) < 1e-3);
  assert.ok(Math.abs(r.lon - 77.2089) < 1e-3);
});

test("coordinate query: hemisphere letter negates", () => {
  const r = parseCoordinateQuery("-33.865, 151.2094 S");
  assert.ok(r);
  assert.ok(r.lat < 0);
});

test("coordinate query: rejects out-of-range", () => {
  assert.equal(parseCoordinateQuery("91,10"), null);
  assert.equal(parseCoordinateQuery("28.6139,190"), null);
});

test("coordinate query: not a coordinate", () => {
  assert.equal(parseCoordinateQuery("London"), null);
  assert.equal(parseCoordinateQuery("JFK"), null);
  assert.equal(parseCoordinateQuery(""), null);
});

test("geocoding hit normalization keeps real fields, nulls missing", () => {
  const hit = normalizeHit({
    id: 1275339, name: "New Delhi", latitude: 28.6, longitude: 77.2,
    country: "India", country_code: "IN", admin1: "Delhi", timezone: "Asia/Kolkata",
    population: 300000, elevation: 216,
  });
  assert.equal(hit.kind, "PLACE");
  assert.equal(hit.id, "geonames:1275339");
  assert.equal(hit.countryId, "IN");
  assert.equal(hit.countryName, "India");
  assert.equal(hit.timezone, "Asia/Kolkata");
  assert.equal(hit.latitude, 28.6);
});

test("geocoding hit normalization rejects coordinate-less rows", () => {
  assert.equal(normalizeHit({ id: 1, name: "Nowhere" }), null);
});
