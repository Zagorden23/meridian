// Auth unit tests — pure functions only (no DB, no network):
// normalizers, OTP hash/verify round-trip, OAuth state seal/open,
// provider status gating, guest-ai quota constant.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateOtpCode, hashOtp, normalizeEmail, normalizePhone,
  OAUTH_PROVIDERS, openOAuthState, providerStatus,
  sealOAuthState, validateName, verifyOtp,
} from "./auth.js";

describe("auth normalizers", () => {
  it("lowercases and trims email", () => {
    assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
  });
  it("rejects bad email", () => {
    assert.throws(() => normalizeEmail("not-an-email"), /valid email/);
    assert.throws(() => normalizeEmail("a@b"), /valid email/);
  });
  it("normalizes phone to E.164", () => {
    assert.equal(normalizePhone("98765 43210", "+91"), "+919876543210");
    assert.equal(normalizePhone("+1 (415) 555-0132"), "+14155550132");
  });
  it("rejects bad phone", () => {
    assert.throws(() => normalizePhone("123"), /country code/);
    assert.throws(() => normalizePhone("abcdefghij", "+91"), /country code/);
  });
  it("trims names to 120 chars", () => {
    assert.equal(validateName("  Ada  "), "Ada");
    assert.ok(validateName("x".repeat(500)).length <= 120);
  });
});

describe("OTP crypto", () => {
  it("generates 6-digit codes", () => {
    for (let i = 0; i < 20; i += 1) assert.match(generateOtpCode(), /^\d{6}$/);
  });
  it("hash/verify round-trips and rejects wrong codes", async () => {
    const { salt, codeHash } = await hashOtp("482916");
    assert.equal(await verifyOtp("482916", salt, codeHash), true);
    assert.equal(await verifyOtp("482915", salt, codeHash), false);
    assert.equal(await verifyOtp(" 482916 ", salt, codeHash), true);
  });
  it("salts are unique per hash", async () => {
    const a = await hashOtp("111111");
    const b = await hashOtp("111111");
    assert.notEqual(a.codeHash, b.codeHash);
  });
});

describe("OAuth state + provider gating", () => {
  it("seals and opens state, rejects tampering", () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret-min-32-chars-0123456789";
    const sealed = sealOAuthState({ state: "s1", nonce: "n1", provider: "google", intent: "login" });
    const back = openOAuthState(sealed);
    assert.equal(back.provider, "google");
    assert.throws(() => openOAuthState(`${sealed}tampered`), /expired/);
    assert.throws(() => openOAuthState("garbage"), /expired/);
  });
  it("all four providers declared, unconfigured without creds", () => {
    assert.deepEqual(Object.keys(OAUTH_PROVIDERS).sort(), ["amazon", "apple", "google", "microsoft"]);
    for (const p of providerStatus()) {
      if (!process.env[p.id === "apple" ? "APPLE_CLIENT_ID" : `${p.id.toUpperCase()}_CLIENT_ID`]) {
        assert.equal(p.configured, false);
        assert.ok(p.missing.length > 0);
      }
    }
  });
  it("startOAuthUrl throws honest 503 when unconfigured", async () => {
    const { startOAuthUrl } = await import("./auth.js");
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    assert.throws(() => startOAuthUrl("google", "http://localhost:8080"), /not configured/);
    assert.throws(() => startOAuthUrl("nope", "http://localhost:8080"), /Unknown/);
  });
  it("sealed state preserves the sanitized return destination", () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret-min-32-chars-0123456789";
    const sealed = sealOAuthState({ state: "s", nonce: "n", provider: "google", intent: "login", returnTo: "/app?m=travel" });
    assert.equal(openOAuthState(sealed).returnTo, "/app?m=travel");
  });
});

describe("safeReturnTo", () => {
  it("accepts same-origin paths, rejects open redirects", async () => {
    const { safeReturnTo: srt } = await import("./auth.js");
    assert.equal(srt("/app?m=travel"), "/app?m=travel");
    assert.equal(srt("/travel/flights"), "/travel/flights");
    assert.equal(srt("https://evil.example/phish"), "/app");
    assert.equal(srt("//evil.example/x"), "/app");
    assert.equal(srt(""), "/app");
    assert.equal(srt(null), "/app");
    assert.equal(srt("/app\\@evil.example"), "/app");
    assert.equal(srt("javascript:alert(1)"), "/app");
  });
  it("startOAuthUrl seals the requested destination", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret-min-32-chars-0123456789";
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    const { startOAuthUrl } = await import("./auth.js");
    const { url, sealed } = startOAuthUrl("google", "http://localhost:8080", "login", "/app?m=weather");
    assert.match(url, /^https:\/\/accounts\.google\.com\//);
    assert.equal(openOAuthState(sealed).returnTo, "/app?m=weather");
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
