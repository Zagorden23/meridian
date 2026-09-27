import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arcAltitude, bearingDeg, boundingBox, distanceKm, interpolateGreatCircle,
  normalizeName, validateLatLon,
} from "./geo-math.js";

describe("geo-math", () => {
  it("Chennai → Kolkata distance is in the real range", () => {
    const km = distanceKm(13.0827, 80.2707, 22.5726, 88.3639);
    assert.ok(km > 1300 && km < 1420, `got ${km}`);
  });
  it("bearing is north-east", () => {
    const b = bearingDeg(13.0827, 80.2707, 22.5726, 88.3639);
    assert.ok(b > 25 && b < 65, `got ${b}`);
  });
  it("rejects invalid coordinates", () => {
    assert.equal(validateLatLon(91, 0), false);
    assert.equal(validateLatLon(0, 181), false);
    assert.equal(validateLatLon("x", 0), false);
    assert.equal(validateLatLon(45, -73), true);
  });
  it("normalizes diacritics for search ranking", () => {
    assert.equal(normalizeName("Reykjavík"), "reykjavik");
    assert.equal(normalizeName("São Paulo"), "sao paulo");
    assert.equal(normalizeName("  New   York "), "new york");
  });
  it("interpolation hits endpoints exactly", () => {
    const a = interpolateGreatCircle(13, 80, 22, 88, 0);
    const b = interpolateGreatCircle(13, 80, 22, 88, 1);
    assert.ok(Math.abs(a.lat - 13) < 1e-9 && Math.abs(a.lon - 80) < 1e-9);
    assert.ok(Math.abs(b.lat - 22) < 1e-9 && Math.abs(b.lon - 88) < 1e-9);
  });
  it("bounding box contains its center", () => {
    const box = boundingBox(13.08, 80.27, 100);
    assert.ok(box.minLat <= 13.08 && box.maxLat >= 13.08);
  });
  it("long routes arc higher than short hops", () => {
    assert.ok(arcAltitude(9000) > arcAltitude(500));
  });
});
