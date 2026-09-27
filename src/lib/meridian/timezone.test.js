import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatOffset, isDaytime, sunTimes, utcOffsetMinutes } from "./timezone.js";

describe("timezone", () => {
  it("Kolkata offset is +05:30", () => {
    assert.equal(utcOffsetMinutes("Asia/Kolkata", new Date("2026-01-15T12:00:00Z")), 330);
  });
  it("formats offsets", () => {
    assert.equal(formatOffset(330), "UTC+05:30");
    assert.equal(formatOffset(-300), "UTC-05:00");
    assert.equal(formatOffset(null), null);
  });
  it("sun times are labelled estimated", () => {
    const st = sunTimes(13.08, 80.27, new Date("2026-03-20T00:00:00Z"));
    assert.equal(st.estimated, true);
    assert.ok(st.sunrise && st.sunset);
  });
  it("daytime detection returns a boolean near the equator at noon", () => {
    const day = isDaytime(0, 0, new Date("2026-03-20T12:00:00Z"));
    assert.equal(day, true);
  });
});
