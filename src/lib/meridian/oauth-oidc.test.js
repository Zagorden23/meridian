// Google / Microsoft / Apple sign-in, end to end, against stand-in providers.
//
// The real flow is driven exactly as the routes drive it — authorize URL →
// sealed state → code exchange → id_token verification → account → session —
// with only the providers' HTTPS endpoints replaced: each stand-in publishes a
// JWKS and signs id_tokens with the matching private key, so signature, issuer,
// audience, expiry and nonce checks all run for real. No request leaves the
// machine; an unexpected URL fails the test.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SignJWT, decodeProtectedHeader, exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from "jose";

const ORIGIN = "https://meridian.example.com";
const MS_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
const MS_ORG_TENANT = "11111111-2222-3333-4444-555555555555";

const ENV = {
  SESSION_SECRET: "test-session-secret-0123456789abcdef0123456789abcdef",
  GOOGLE_CLIENT_ID: "meridian-test.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "google-secret",
  MICROSOFT_CLIENT_ID: "ms-client-id",
  MICROSOFT_CLIENT_SECRET: "ms-secret",
  MICROSOFT_TENANT_ID: "common",
  APPLE_CLIENT_ID: "com.meridian.web",
  APPLE_TEAM_ID: "TEAM123456",
  APPLE_KEY_ID: "KEY1234567",
};

function makeRequest(headers = {}) {
  return new Request(`${ORIGIN}/api/auth/test`, {
    headers: { "x-forwarded-proto": "https", "user-agent": "meridian-test", ...headers },
  });
}

const cookiePair = (setCookie) => String(setCookie).split(";")[0];

describe("OAuth sign-in against stand-in OpenID providers", () => {
  const saved = {};
  const origFetch = globalThis.fetch;
  const keys = {}; // provider -> { privateKey, jwks }
  let appleSigningPublicKey; // verifies the client_secret Meridian sends Apple
  let lastTokenRequest = null; // { provider, params }
  let nextIdToken = null;
  let auth;

  async function providerKey(kid) {
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    const jwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
    return { privateKey, kid, jwks: { keys: [jwk] } };
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function mintIdToken(provider, claims, { key = keys[provider], expiresIn = "5m" } = {}) {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: key.kid })
      .setIssuedAt()
      .setExpirationTime(expiresIn)
      .sign(key.privateKey);
  }

  /** Start a sign-in the way GET /api/auth/:provider does and unpack what it sealed. */
  function begin(provider, returnTo = "/app") {
    const { url, sealed } = auth.startOAuthUrl(provider, ORIGIN, "login", returnTo);
    const authorize = new URL(url);
    const state = auth.openOAuthState(sealed);
    return { authorize, params: authorize.searchParams, state };
  }

  /** Finish it the way GET /api/auth/:provider/callback does. */
  function finish(provider, state, extra = {}) {
    return auth.resolveOAuthIdentity(provider, "auth-code-from-provider", auth.oauthRedirectUri(provider, ORIGIN), {
      nonce: state.nonce,
      codeVerifier: state.codeVerifier ?? null,
      ...extra,
    });
  }

  before(async () => {
    for (const key of [...Object.keys(ENV), "APPLE_PRIVATE_KEY", "MONGODB_URI", "APP_URL"]) saved[key] = process.env[key];
    Object.assign(process.env, ENV);
    delete process.env.APP_URL;
    const base = saved.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017/meridian";
    const uri = new URL(base);
    uri.pathname = `/meridian_oidc_test_${process.pid}_${Date.now()}`;
    process.env.MONGODB_URI = uri.toString();

    keys.google = await providerKey("google-key-1");
    keys.microsoft = await providerKey("ms-key-1");
    keys.apple = await providerKey("apple-key-1");
    keys.stranger = await providerKey("google-key-1"); // same kid, different key

    // The Sign in with Apple key the operator downloads as a .p8 file — stored,
    // as hosting dashboards store it, on one line with literal "\n".
    const appleSigning = await generateKeyPair("ES256", { extractable: true });
    appleSigningPublicKey = appleSigning.publicKey;
    process.env.APPLE_PRIVATE_KEY = (await exportPKCS8(appleSigning.privateKey)).trim().replace(/\n/g, "\\n");

    globalThis.fetch = async (input, init = {}) => {
      const url = String(input?.url ?? input);
      const tokenEndpoint = (provider) => {
        lastTokenRequest = { provider, params: new URLSearchParams(String(init.body)) };
        return json({ access_token: "access-token", token_type: "Bearer", id_token: nextIdToken });
      };
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return json(keys.google.jwks);
      if (url === "https://oauth2.googleapis.com/token") return tokenEndpoint("google");
      if (url === "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration") {
        return json({ jwks_uri: "https://login.microsoftonline.com/common/discovery/v2.0/keys" });
      }
      if (url === "https://login.microsoftonline.com/common/discovery/v2.0/keys") return json(keys.microsoft.jwks);
      if (url === "https://login.microsoftonline.com/common/oauth2/v2.0/token") return tokenEndpoint("microsoft");
      if (url === "https://appleid.apple.com/auth/keys") return json(keys.apple.jwks);
      if (url === "https://appleid.apple.com/auth/token") return tokenEndpoint("apple");
      throw new Error(`unexpected network request in test: ${url}`);
    };

    auth = await import("./auth.js");
    const { requireMongoConnection } = await import("./mongo.js");
    await requireMongoConnection();
    await auth.ensureAuthIndexes();
  });

  after(async () => {
    globalThis.fetch = origFetch;
    const { connectMongo, disconnectMongo } = await import("./mongo.js");
    try {
      const conn = await connectMongo();
      await conn?.connection?.db?.dropDatabase();
    } catch { /* best-effort cleanup */ }
    await disconnectMongo().catch(() => {});
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("reports all three providers as configured", () => {
    const status = Object.fromEntries(auth.providerStatus().map((p) => [p.id, p.configured]));
    assert.equal(status.google, true);
    assert.equal(status.microsoft, true);
    assert.equal(status.apple, true);
  });

  it("Google: authorize request, PKCE code exchange, verified id_token, account and session", async () => {
    const { authorize, params, state } = begin("google", "/app?m=saved");
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(params.get("client_id"), ENV.GOOGLE_CLIENT_ID);
    assert.equal(params.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
    assert.equal(params.get("response_type"), "code");
    assert.deepEqual(params.get("scope").split(" ").sort(), ["email", "openid", "profile"]);
    assert.equal(params.get("state"), state.state);
    assert.equal(params.get("nonce"), state.nonce);
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(params.get("code_challenge"), createHash("sha256").update(state.codeVerifier).digest("base64url"));
    assert.equal(state.returnTo, "/app?m=saved");

    nextIdToken = await mintIdToken("google", {
      iss: "https://accounts.google.com",
      aud: ENV.GOOGLE_CLIENT_ID,
      sub: "google-user-1",
      email: "Ada@Example.com",
      email_verified: true,
      name: "Ada Lovelace",
      picture: "https://lh3.googleusercontent.com/a/ada",
      nonce: state.nonce,
    });
    const identity = await finish("google", state);

    // What Meridian sent to Google's token endpoint.
    assert.equal(lastTokenRequest.provider, "google");
    assert.equal(lastTokenRequest.params.get("grant_type"), "authorization_code");
    assert.equal(lastTokenRequest.params.get("code"), "auth-code-from-provider");
    assert.equal(lastTokenRequest.params.get("redirect_uri"), `${ORIGIN}/api/auth/google/callback`);
    assert.equal(lastTokenRequest.params.get("client_id"), ENV.GOOGLE_CLIENT_ID);
    assert.equal(lastTokenRequest.params.get("client_secret"), ENV.GOOGLE_CLIENT_SECRET);
    assert.equal(lastTokenRequest.params.get("code_verifier"), state.codeVerifier);

    assert.deepEqual(identity, {
      providerUserId: "google-user-1",
      email: "Ada@Example.com",
      emailVerified: true,
      name: "Ada Lovelace",
      avatar: "https://lh3.googleusercontent.com/a/ada",
    });

    const first = await auth.resolveOAuthAccount(identity, "google");
    assert.equal(first.created, true);
    assert.equal(first.user.email, "ada@example.com");
    assert.equal(first.user.emailVerified, true);

    const session = await auth.createSession(first.user._id, makeRequest(), { method: "google" });
    assert.match(session.cookie, /^meridian_session=[^;]+; Path=\/; HttpOnly; SameSite=Lax; Secure; Max-Age=\d+$/);
    const signedIn = await auth.getSessionUser(makeRequest({ cookie: cookiePair(session.cookie) }));
    assert.equal(signedIn.user.id, first.user._id);
    assert.equal(signedIn.method, "google");
    assert.deepEqual(signedIn.user.providers, ["google"]);

    // Returning visitor: same Google account → same Meridian account.
    const again = await auth.resolveOAuthAccount(identity, "google");
    assert.equal(again.created, false);
    assert.equal(again.user._id, first.user._id);
  });

  it("Google: rejects a token that was not issued for this sign-in", async () => {
    const good = (state, over = {}) => ({
      iss: "https://accounts.google.com",
      aud: ENV.GOOGLE_CLIENT_ID,
      sub: "google-user-2",
      email: "eve@example.com",
      email_verified: true,
      nonce: state.nonce,
      ...over,
    });
    const rejected = (promise) => assert.rejects(promise, (err) => err?.code === "OAUTH_VERIFY_FAILED" && err?.status === 502);

    let { state } = begin("google");
    nextIdToken = await mintIdToken("google", good(state, { nonce: "nonce-from-another-session" }));
    await rejected(finish("google", state)); // replayed from another session

    ({ state } = begin("google"));
    nextIdToken = await mintIdToken("google", good(state, { aud: "some-other-app.apps.googleusercontent.com" }));
    await rejected(finish("google", state)); // minted for a different application

    ({ state } = begin("google"));
    nextIdToken = await mintIdToken("google", good(state, { iss: "https://accounts.evil.example" }));
    await rejected(finish("google", state)); // wrong issuer

    ({ state } = begin("google"));
    nextIdToken = await mintIdToken("google", good(state), { key: keys.stranger });
    await rejected(finish("google", state)); // not signed by Google's key

    ({ state } = begin("google"));
    nextIdToken = await mintIdToken("google", good(state), { expiresIn: "-10m" });
    await rejected(finish("google", state)); // expired

    ({ state } = begin("google"));
    nextIdToken = "not.a.jwt";
    await rejected(finish("google", state));
  });

  it("Microsoft: personal accounts are verified, work accounts need Microsoft's own proof", async () => {
    const { authorize, params, state } = begin("microsoft");
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    assert.equal(params.get("redirect_uri"), `${ORIGIN}/api/auth/microsoft/callback`);
    assert.ok(params.get("scope").split(" ").includes("openid"));

    // Outlook / Hotmail account: no email_verified claim, address in preferred_username.
    nextIdToken = await mintIdToken("microsoft", {
      iss: `https://login.microsoftonline.com/${MS_CONSUMER_TENANT}/v2.0`,
      aud: ENV.MICROSOFT_CLIENT_ID,
      tid: MS_CONSUMER_TENANT,
      sub: "ms-personal-1",
      preferred_username: "grace@outlook.com",
      name: "Grace Hopper",
      nonce: state.nonce,
    });
    const personal = await finish("microsoft", state);
    assert.equal(lastTokenRequest.params.get("client_secret"), ENV.MICROSOFT_CLIENT_SECRET);
    assert.equal(lastTokenRequest.params.get("code_verifier"), state.codeVerifier);
    assert.equal(personal.email, "grace@outlook.com");
    assert.equal(personal.emailVerified, true);
    const account = await auth.resolveOAuthAccount(personal, "microsoft");
    assert.equal(account.created, true);
    assert.equal(account.user.email, "grace@outlook.com");

    // Work/school tenant: an admin can put any address in the email claim, so
    // without email_verified / xms_edov it is not treated as proven.
    const org = begin("microsoft");
    nextIdToken = await mintIdToken("microsoft", {
      iss: `https://login.microsoftonline.com/${MS_ORG_TENANT}/v2.0`,
      aud: ENV.MICROSOFT_CLIENT_ID,
      tid: MS_ORG_TENANT,
      sub: "ms-work-1",
      email: "ada@example.com", // the Google user's address
      name: "Not Ada",
      nonce: org.state.nonce,
    });
    const work = await finish("microsoft", org.state);
    assert.equal(work.emailVerified, false);
    const workAccount = await auth.resolveOAuthAccount(work, "microsoft");
    assert.equal(workAccount.created, true, "gets its own account");
    assert.equal(workAccount.user.email, null, "and does not take over the unproven address");

    // An issuer that is not a Microsoft tenant is refused even if the signature checks out.
    const forged = begin("microsoft");
    nextIdToken = await mintIdToken("microsoft", {
      iss: "https://login.microsoftonline.com.evil.example/common/v2.0",
      aud: ENV.MICROSOFT_CLIENT_ID,
      sub: "ms-forged",
      nonce: forged.state.nonce,
    });
    await assert.rejects(finish("microsoft", forged.state), (err) => err?.code === "OAUTH_VERIFY_FAILED");
  });

  it("Apple: form_post authorize, ES256 client secret, private relay address and first-login name", async () => {
    const { authorize, params, state } = begin("apple");
    assert.equal(`${authorize.origin}${authorize.pathname}`, "https://appleid.apple.com/auth/authorize");
    assert.equal(params.get("client_id"), ENV.APPLE_CLIENT_ID);
    assert.equal(params.get("redirect_uri"), `${ORIGIN}/api/auth/apple/callback`);
    assert.equal(params.get("response_mode"), "form_post");
    assert.equal(params.get("scope"), "name email");

    nextIdToken = await mintIdToken("apple", {
      iss: "https://appleid.apple.com",
      aud: ENV.APPLE_CLIENT_ID,
      sub: "000123.apple-user.0001",
      email: "x7k2m9@privaterelay.appleid.com",
      email_verified: "true", // Apple sends this as a string
      is_private_email: "true",
      nonce: state.nonce,
    });
    const identity = await finish("apple", state, {
      appleUser: JSON.stringify({ name: { firstName: "Katherine", lastName: "Johnson" }, email: "x7k2m9@privaterelay.appleid.com" }),
    });

    // Apple's client_secret is a short-lived JWT signed with the operator's .p8 key.
    const clientSecret = lastTokenRequest.params.get("client_secret");
    assert.equal(decodeProtectedHeader(clientSecret).kid, ENV.APPLE_KEY_ID);
    const { payload } = await jwtVerify(clientSecret, appleSigningPublicKey, {
      issuer: ENV.APPLE_TEAM_ID,
      subject: ENV.APPLE_CLIENT_ID,
      audience: "https://appleid.apple.com",
      algorithms: ["ES256"],
    });
    assert.ok(payload.exp - payload.iat <= 600);
    assert.equal(lastTokenRequest.params.get("client_id"), ENV.APPLE_CLIENT_ID);

    assert.equal(identity.providerUserId, "000123.apple-user.0001");
    assert.equal(identity.emailVerified, true);
    assert.equal(identity.name, "Katherine Johnson");

    const account = await auth.resolveOAuthAccount(identity, "apple");
    assert.equal(account.created, true);
    assert.equal(auth.publicUser(account.user).emailIsPrivateRelay, true);
    assert.equal(account.user.name, "Katherine Johnson");

    // Apple only sends the name once; later sign-ins must still find the account.
    const later = begin("apple");
    nextIdToken = await mintIdToken("apple", {
      iss: "https://appleid.apple.com",
      aud: ENV.APPLE_CLIENT_ID,
      sub: "000123.apple-user.0001",
      email: "x7k2m9@privaterelay.appleid.com",
      email_verified: "true",
      nonce: later.state.nonce,
    });
    const returning = await auth.resolveOAuthAccount(await finish("apple", later.state), "apple");
    assert.equal(returning.created, false);
    assert.equal(returning.user._id, account.user._id);
    assert.equal(returning.user.name, "Katherine Johnson");
  });

  it("never merges a second provider into an existing verified account by email alone", async () => {
    const { state } = begin("microsoft");
    nextIdToken = await mintIdToken("microsoft", {
      iss: `https://login.microsoftonline.com/${MS_CONSUMER_TENANT}/v2.0`,
      aud: ENV.MICROSOFT_CLIENT_ID,
      tid: MS_CONSUMER_TENANT,
      sub: "ms-personal-ada",
      email: "ada@example.com", // already owned by the Google account above
      nonce: state.nonce,
    });
    const identity = await finish("microsoft", state);
    await assert.rejects(
      auth.resolveOAuthAccount(identity, "microsoft"),
      (err) => err?.status === 409 && err?.code === "ACCOUNT_LINK_REQUIRED",
    );
    // Signed in, the same person may link it explicitly.
    const { findUserByEmail } = await import("./auth-storage.js");
    const ada = await findUserByEmail("ada@example.com");
    const linked = await auth.resolveOAuthAccount(identity, "microsoft", { sessionUserId: ada._id, intent: "link" });
    assert.equal(linked.linked, true);
    assert.deepEqual(auth.publicUser(linked.user).providers.sort(), ["google", "microsoft"]);
  });

  it("refuses a callback whose sealed state was altered", () => {
    const { sealed } = auth.startOAuthUrl("google", ORIGIN, "login", "/app");
    const [body, sig] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url")), returnTo: "/app?evil=1" })).toString("base64url");
    assert.throws(() => auth.openOAuthState(`${forged}.${sig}`), (err) => err?.code === "OAUTH_STATE_INVALID");
    assert.throws(() => auth.openOAuthState("missing-signature"), (err) => err?.code === "OAUTH_STATE_INVALID");
    assert.equal(auth.openOAuthState(sealed).provider, "google");
  });

  it("trims whitespace around Google OAuth credentials and rejects blank values", async () => {
    const prevId = process.env.GOOGLE_CLIENT_ID;
    const prevSecret = process.env.GOOGLE_CLIENT_SECRET;
    try {
      process.env.GOOGLE_CLIENT_ID = "   \n  ";
      process.env.GOOGLE_CLIENT_SECRET = "  ";
      const blank = auth.providerStatus().find((p) => p.id === "google");
      assert.equal(blank.configured, false);
      assert.deepEqual(blank.missing, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);

      process.env.GOOGLE_CLIENT_ID = `  ${ENV.GOOGLE_CLIENT_ID}\n`;
      process.env.GOOGLE_CLIENT_SECRET = ` ${ENV.GOOGLE_CLIENT_SECRET} `;
      const padded = auth.providerStatus().find((p) => p.id === "google");
      assert.equal(padded.configured, true);

      const { params, state } = begin("google", "/app");
      assert.equal(params.get("client_id"), ENV.GOOGLE_CLIENT_ID);

      nextIdToken = await mintIdToken("google", {
        iss: "https://accounts.google.com",
        aud: ENV.GOOGLE_CLIENT_ID,
        sub: "google-user-trimmed",
        email: "trimmed@example.com",
        email_verified: true,
        name: "Trimmed User",
        nonce: state.nonce,
      });
      const identity = await finish("google", state);
      assert.equal(identity.providerUserId, "google-user-trimmed");
      assert.equal(lastTokenRequest.params.get("client_id"), ENV.GOOGLE_CLIENT_ID);
      assert.equal(lastTokenRequest.params.get("client_secret"), ENV.GOOGLE_CLIENT_SECRET);
    } finally {
      process.env.GOOGLE_CLIENT_ID = prevId;
      process.env.GOOGLE_CLIENT_SECRET = prevSecret;
    }
  });
});
