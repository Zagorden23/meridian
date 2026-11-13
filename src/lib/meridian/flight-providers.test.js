import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseFlightNumber, providerCoverage, validateFlightSearch } from "./flight-providers.js";

describe("flights", () => {
  it("parses common flight-number variants", () => {
    for (const raw of ["6E521", "6E 521", "6E-521"]) {
      const p = parseFlightNumber(raw);
      assert.equal(p.airlineCode, "6E");
      assert.equal(p.number, "521");
      assert.equal(p.normalized, "6E 521");
    }
  });
  it("rejects garbage flight numbers", () => {
    assert.throws(() => parseFlightNumber("hello"), /Unrecognized/);
  });
  it("domestic validation requires same country", () => {
    assert.throws(
      () => validateFlightSearch({ tripType: "domestic", originAirport: "MAA", destinationAirport: "LHR", originCountry: "india", destinationCountry: "united-kingdom" }),
      /same country/,
    );
  });
  it("international validation requires different countries", () => {
    assert.throws(
      () => validateFlightSearch({ tripType: "international", originAirport: "MAA", destinationAirport: "BOM", originCountry: "india", destinationCountry: "india" }),
      /different origin/,
    );
  });
  it("rejects identical airports and bad passenger counts", () => {
    assert.throws(() => validateFlightSearch({ originAirport: "MAA", destinationAirport: "MAA" }), /differ/);
    assert.throws(() => validateFlightSearch({ originAirport: "MAA", destinationAirport: "BOM", passengers: 12 }), /Passengers/);
  });
  it("coverage is honest without keys", () => {
    const cov = providerCoverage();
    assert.equal(cov.livePositions.available, true);
    if (!process.env.FLIGHT_API_KEY) {
      assert.equal(cov.scheduleSearch.available, false);
      assert.equal(cov.pnrLookup.available, false);
    }
  });
  it("a key alone never claims schedule coverage (no adapter ships yet)", () => {
    const before = process.env.FLIGHT_API_KEY;
    process.env.FLIGHT_API_KEY = "test-key";
    try {
      const cov = providerCoverage();
      assert.equal(cov.scheduleSearch.available, false);
      assert.equal(cov.flightStatus.available, false);
      assert.equal(cov.airportBoards.available, false);
      assert.match(cov.scheduleSearch.note, /adapter/);
    } finally {
      if (before === undefined) delete process.env.FLIGHT_API_KEY;
      else process.env.FLIGHT_API_KEY = before;
    }
  });
});
