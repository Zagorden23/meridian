// Thin-route helper: rate limiting + envelope + security headers for /api/*.
// Keeps every REST file to a few lines of domain logic.
import { json } from "@tanstack/react-start";
import { handleApi } from "./api-envelope.js";
import { clientKey, rateLimit } from "./rate-limit.js";

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
};

export function apiRoute(handlers, { limit = 120, windowMs = 60_000 } = {}) {
  const wrapped = {};
  for (const [method, fn] of Object.entries(handlers)) {
    wrapped[method] = async ({ request, params }) => {
      const url = new URL(request.url);
      try {
        rateLimit(clientKey(request, `${method}:${url.pathname}`), { limit, windowMs });
      } catch (e) {
        return json(
          { success: false, error: { code: "RATE_LIMITED", message: e.message } },
          { status: 429, headers: SECURITY_HEADERS },
        );
      }
      const { status, body } = await handleApi((rid) => fn({ request, params, url, requestId: rid }));
      return json(body, { status, headers: SECURITY_HEADERS });
    };
  }
  return wrapped;
}

export async function readJson(request, maxBytes = 65536) {
  const text = await request.text();
  // A page on another site can make a browser POST here, but only as a plain
  // form — it cannot send JSON without a CORS preflight this server never
  // grants. Insisting on a JSON body therefore keeps other sites from driving
  // sign-in (or any other POST) with a visitor's browser.
  if (text && !/^application\/json\b/i.test(String(request.headers.get("content-type") ?? "").trim())) {
    throw Object.assign(new Error("Send the request body as application/json."), { status: 415, code: "UNSUPPORTED_MEDIA_TYPE" });
  }
  if (text.length > maxBytes) {
    throw Object.assign(new Error("Request body too large."), { status: 413, code: "PAYLOAD_TOO_LARGE" });
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { status: 400, code: "INVALID_JSON" });
  }
}
