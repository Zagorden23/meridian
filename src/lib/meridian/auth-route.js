// Auth route helper — envelope-compatible JSON Responses with Set-Cookie
// support (apiRoute's json() cannot set cookies, auth needs HttpOnly ones).
import { ok, fail, requestId } from "./api-envelope.js";
import { rateLimit } from "./rate-limit.js";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
};

export function sendData(data, { source = "meridian-auth", status = 200, cookies = [] } = {}) {
  const rid = requestId();
  const headers = new Headers({ "content-type": "application/json", ...SECURITY_HEADERS });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(ok(data, { source, requestId: rid })), { status, headers });
}

export function sendError(err, cookies = []) {
  const rid = requestId();
  const code = err?.code ?? "INTERNAL_ERROR";
  const status = err?.status ?? 500;
  if (status >= 500) console.error(`[auth] ${rid} ${code}:`, err?.message ?? err);
  const { body } = fail(code, status >= 500 ? "Authentication is temporarily unavailable." : (err?.message ?? "Request failed"), status, rid);
  const headers = new Headers({ "content-type": "application/json", ...SECURITY_HEADERS });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(JSON.stringify(body), { status, headers });
}

export function withRateLimit(key, opts) {
  try {
    rateLimit(key, opts);
  } catch {
    const err = new Error("Too many attempts. Please wait and try again.");
    err.status = 429;
    err.code = "RATE_LIMITED";
    throw err;
  }
}

const KNOWN_OAUTH_PROVIDERS = new Set(["google", "microsoft", "apple", "amazon"]);

/**
 * Where a failed OAuth attempt sends the browser. Only a safe error code and a
 * known provider id ever reach the URL — never provider messages or tokens.
 *
 *   sign-in → /auth?error=CODE&oauthProvider=<id>[&mode=signup][&returnTo=…]
 *   linking → the page it started from (e.g. Settings) with ?authError=CODE.
 *             A signed-in user is bounced off /auth immediately, so the error
 *             has to travel with them or it would never be seen.
 *
 * `returnTo` must already be sanitized (safeReturnTo) by the caller.
 */
export function oauthFailureLocation(code, { providerId = null, returnTo = "/app", intent = "login", mode = null } = {}) {
  const provider = KNOWN_OAUTH_PROVIDERS.has(providerId) ? providerId : null;
  if (intent === "link") {
    const back = new URL(returnTo, "http://meridian.invalid");
    back.searchParams.set("authError", code);
    if (provider) back.searchParams.set("oauthProvider", provider);
    return `${back.pathname}${back.search}`;
  }
  const qs = new URLSearchParams({ error: code });
  if (provider) qs.set("oauthProvider", provider);
  if (mode === "signup") qs.set("mode", "signup");
  if (returnTo && returnTo !== "/app") qs.set("returnTo", returnTo);
  return `/auth?${qs}`;
}

export { SECURITY_HEADERS };
