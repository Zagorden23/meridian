import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fail, ok } from "./api-envelope.js";
import { ageLabel, freshness } from "./data-freshness.js";

describe("api envelope + freshness", () => {
  it("success envelope shape", () => {
    const body = ok({ a: 1 }, { source: "t" });
    assert.equal(body.success, true);
    assert.equal(body.data.a, 1);
    assert.equal(body.meta.source, "t");
    assert.ok(body.meta.requestId);
  });
  it("error envelope shape", () => {
    const { status, body } = fail("NOPE", "bad", 400);
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.equal(body.error.code, "NOPE");
  });
  it("freshness bands", () => {
    const now = new Date().toISOString();
    assert.equal(freshness(now, 60000, Date.parse(now) + 1000), "LIVE");
    assert.equal(freshness(new Date(Date.now() - 10 * 60000).toISOString(), 60000), "STALE");
    assert.equal(ageLabel(new Date(Date.now() - 120000).toISOString()), "2 min ago");
  });
});
