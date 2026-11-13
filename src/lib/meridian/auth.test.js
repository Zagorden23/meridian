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
  it("normalizes phone to E.164 and handles trunk zeros", () => {
    assert.equal(normalizePhone("98765 43210", "+91"), "+919876543210");
    assert.equal(normalizePhone("+1 (415) 555-0132"), "+14155550132");
    assert.equal(normalizePhone("07700 900123", "+44"), "+447700900123");
    assert.equal(normalizePhone("06 1234 5678", "+39"), "+390612345678");
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
  it("startOAuthUrl seals PKCE verifier, prompt, mode, and destination", async () => {
    process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? "test-secret-min-32-chars-0123456789";
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
    process.env.MICROSOFT_CLIENT_ID = "ms-client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "ms-client-secret";
    const { startOAuthUrl } = await import("./auth.js");
    try {
      const { url, sealed } = startOAuthUrl("google", "http://localhost:8080", "login", "/app?m=weather", { mode: "signup" });
      const parsed = new URL(url);
      assert.equal(parsed.origin, "https://accounts.google.com");
      assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
      assert.ok(parsed.searchParams.get("code_challenge")?.length >= 43);
      assert.equal(parsed.searchParams.get("prompt"), "select_account");
      const opened = openOAuthState(sealed);
      assert.equal(opened.returnTo, "/app?m=weather");
      assert.equal(opened.mode, "signup");
      assert.ok(opened.codeVerifier?.length >= 43);

      const ms = startOAuthUrl("microsoft", "https://app.example.com");
      const msUrl = new URL(ms.url);
      assert.match(msUrl.pathname, /\/oauth2\/v2\.0\/authorize$/);
      assert.equal(msUrl.searchParams.get("code_challenge_method"), "S256");
      assert.equal(msUrl.searchParams.get("prompt"), "select_account");
    } finally {
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;
      delete process.env.MICROSOFT_CLIENT_ID;
      delete process.env.MICROSOFT_CLIENT_SECRET;
    }
  });
});

describe("proxy origin, dev sandbox gating, and OAuth linking rules", () => {
  it("resolves forwarded origin cleanly", async () => {
    const { publicOrigin } = await import("./auth.js");
    const req = new Request("http://127.0.0.1:8080/api/auth/google", {
      headers: { "x-forwarded-proto": "https", "x-forwarded-host": "meridian.example.com" },
    });
    assert.equal(publicOrigin(req), "https://meridian.example.com");
  });

  it("never enables dev OTP sandbox outside Vite DEV", async () => {
    const { isDevOtpSandbox, emailCanDeliver, smsCanDeliver } = await import("./auth.js");
    assert.equal(isDevOtpSandbox(), false);
    if (!process.env.EMAIL_PROVIDER_KEY) assert.equal(emailCanDeliver(), false);
    if (!process.env.SMS_PROVIDER_KEY) assert.equal(smsCanDeliver(), false);
  });

  it("planOAuthAccount refuses silent auto-merge for verified emails and claims unverified ones", async () => {
    const { planOAuthAccount } = await import("./auth.js");
    assert.throws(
      () => planOAuthAccount({
        providerId: "google",
        intent: "login",
        sessionUserId: null,
        byProvider: null,
        me: null,
        byEmail: { _id: "u1", emailVerified: true, accountStatus: "active" },
      }),
      (err) => err?.code === "ACCOUNT_LINK_REQUIRED",
    );
    assert.deepEqual(
      planOAuthAccount({
        providerId: "google",
        intent: "login",
        sessionUserId: null,
        byProvider: null,
        me: null,
        byEmail: { _id: "u1", emailVerified: false, accountStatus: "active" },
      }),
      { action: "claim" },
    );
    assert.throws(
      () => planOAuthAccount({
        providerId: "apple",
        intent: "link",
        sessionUserId: "u2",
        byProvider: { _id: "u1", accountStatus: "active" },
        me: { _id: "u2", authProviders: [] },
        byEmail: null,
      }),
      (err) => err?.code === "ACCOUNT_LINK_CONFLICT",
    );
  });
});
