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

export { SECURITY_HEADERS };
