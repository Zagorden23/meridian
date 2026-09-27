// OpenID Connect id_token verification — server-only.
//
// Every OAuth provider MERIDIAN trusts issues a signed id_token. This module
// verifies that signature against the provider's published JWKS and then checks
// the claims that actually matter for a login: issuer, audience (our own client
// id), expiry and the nonce we generated for this specific authorization
// request. Without the nonce check a replayed id_token from another session
// would be accepted; without the audience check a token minted for a different
// application would be accepted.
//
// Nothing here is optional and nothing here is faked: if a provider's keys
// cannot be fetched, or a claim does not match, the sign-in fails with an
// honest error instead of falling back to an unverified identity.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { httpError } from "./api-envelope.js";

const JWKS_TTL_MS = 60 * 60 * 1000; // jose also honours the response Cache-Control

/** Remote key sets are expensive to build — one per issuer for the process. */
const keySets = new Map();

function keySet(url) {
  let set = keySets.get(url);
  if (!set) {
    set = createRemoteJWKSet(new URL(url), {
      cooldownDuration: 30_000,
      cacheMaxAge: JWKS_TTL_MS,
      timeoutDuration: 10_000,
    });
    keySets.set(url, set);
  }
  return set;
}

const GOOGLE = {
  id: "google",
  label: "Google",
  clientIdEnv: "GOOGLE_CLIENT_ID",
  jwks: "https://www.googleapis.com/oauth2/v3/certs",
  // Google has emitted both spellings of the issuer for years.
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};

const APPLE = {
  id: "apple",
  label: "Apple",
  clientIdEnv: "APPLE_CLIENT_ID",
  jwks: "https://appleid.apple.com/auth/keys",
  issuers: ["https://appleid.apple.com"],
};

function microsoftAuthority() {
  return (process.env.MICROSOFT_TENANT_ID || "common").trim();
}

let microsoftDiscovery = null; // { jwks, exp }

/**
 * Microsoft rotates the authority per tenant, so its key set comes from the
 * tenant's OpenID discovery document rather than a fixed URL.
 */
async function microsoftMeta() {
  if (microsoftDiscovery && microsoftDiscovery.exp > Date.now()) return microsoftDiscovery;
  const authority = microsoftAuthority();
  const url = `https://login.microsoftonline.com/${encodeURIComponent(authority)}/v2.0/.well-known/openid-configuration`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) {
    throw httpError(502, "OAUTH_VERIFY_FAILED", "Microsoft sign-in could not be verified.");
  }
  const doc = await res.json();
  if (!doc?.jwks_uri) {
    throw httpError(502, "OAUTH_VERIFY_FAILED", "Microsoft sign-in could not be verified.");
  }
  microsoftDiscovery = { jwks: doc.jwks_uri, exp: Date.now() + JWKS_TTL_MS };
  return microsoftDiscovery;
}

/**
 * The issuer of a Microsoft token identifies the *account's* tenant, not the
 * authority we queried, so it is validated by shape (`…/<tenant>/v2.0`) instead
 * of equality.
 */
function microsoftIssuerOk(iss) {
  return /^https:\/\/login\.microsoftonline\.com\/[0-9a-fA-F-]{36}\/v2\.0$/.test(String(iss ?? ""));
}

function verifyFailed(label = "This provider") {
  return httpError(502, "OAUTH_VERIFY_FAILED", `${label} sign-in could not be verified.`);
}

/**
 * Verify an id_token and return its claims.
 *
 * @param {string} providerId  google | microsoft | apple
 * @param {string} idToken     the compact JWS returned by the token endpoint
 * @param {{ nonce?: string }} options  the nonce issued with this authorization
 */
export async function verifyIdToken(providerId, idToken, { nonce } = {}) {
  const token = String(idToken ?? "");
  if (token.split(".").length !== 3) throw verifyFailed();

  let claims;
  if (providerId === "google" || providerId === "apple") {
    const cfg = providerId === "google" ? GOOGLE : APPLE;
    const clientId = process.env[cfg.clientIdEnv];
    if (!clientId) throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED", `${cfg.label} sign-in is not configured.`);
    try {
      ({ payload: claims } = await jwtVerify(token, keySet(cfg.jwks), {
        issuer: cfg.issuers,
        audience: clientId,
        clockTolerance: 60,
      }));
    } catch (err) {
      console.error(`[oidc] ${providerId} id_token rejected:`, err?.code ?? err?.message);
      throw verifyFailed(cfg.label);
    }
  } else if (providerId === "microsoft") {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) throw httpError(503, "OAUTH_PROVIDER_UNCONFIGURED", "Microsoft sign-in is not configured.");
    const meta = await microsoftMeta();
    try {
      ({ payload: claims } = await jwtVerify(token, keySet(meta.jwks), {
        audience: clientId,
        clockTolerance: 60,
      }));
    } catch (err) {
      console.error(`[oidc] microsoft id_token rejected:`, err?.code ?? err?.message);
      throw verifyFailed("Microsoft");
    }
    if (!microsoftIssuerOk(claims.iss)) {
      console.error("[oidc] microsoft id_token issuer mismatch:", claims.iss);
      throw verifyFailed("Microsoft");
    }
  } else {
    throw httpError(400, "UNKNOWN_PROVIDER", "Unknown authentication provider.");
  }

  // The nonce binds this token to the authorization request we started, so a
  // token captured from another session cannot be replayed into this one.
  if (!nonce || claims.nonce !== nonce) {
    console.error(`[oidc] ${providerId} nonce mismatch`);
    throw verifyFailed(providerId === "google" ? "Google" : providerId === "apple" ? "Apple" : "Microsoft");
  }

  return claims;
}

/** `email_verified` arrives as a boolean from Apple and a boolean from Google. */
export function claimIsTrue(value) {
  return value === true || value === "true";
}
