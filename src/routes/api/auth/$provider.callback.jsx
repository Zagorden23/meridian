import { createFileRoute } from "@tanstack/react-router";
import { SECURITY_HEADERS, oauthFailureLocation } from "@/lib/meridian/auth-route.js";
import {
  authNoticeCookie, clearOAuthCookie, createSession, getSessionUser, oauthRedirectUri, openOAuthState,
  parseCookies, publicOrigin, resolveOAuthAccount, resolveOAuthIdentity,
  safeReturnTo, secureContext, touchLogin,
} from "@/lib/meridian/auth.js";

// Apple's one-time `user` payload (display name) rides across the POST→GET
// replay in a short-lived HttpOnly cookie rather than in the URL.
const APPLE_USER_COOKIE = "meridian_apple_user";
const appleUserCookie = (value, secure, maxAge) =>
  `${APPLE_USER_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${maxAge}`;

/**
 * Apple answers with a cross-site form POST (`response_mode=form_post`), and
 * browsers withhold SameSite=Lax cookies from cross-site POSTs — so neither the
 * sealed state cookie nor, when linking, the session would arrive with it and
 * every Apple sign-in would fail the state check. Replaying the result as a
 * top-level GET to this same route brings both cookies back without loosening
 * them to SameSite=None.
 */
async function replayAsGet(request) {
  const url = new URL(request.url);
  const secure = secureContext(request);
  const form = await request.formData().catch(() => null);
  const qs = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const value = form?.get(key);
    if (typeof value === "string" && value) qs.set(key, value.slice(0, 2048));
  }
  const headers = new Headers({ ...SECURITY_HEADERS, location: `${url.pathname}?${qs}` });
  const user = form?.get("user");
  if (typeof user === "string" && user) {
    headers.append("set-cookie", appleUserCookie(user.slice(0, 1024), secure, 120));
  }
  return new Response(null, { status: 303, headers });
}

// GET /api/auth/:provider/callback
// Success → 302 to the sanitized pre-login destination (+ session cookie on sign-in).
// Failure → 302 carrying a safe, user-facing code — never stack traces or tokens.
async function complete(request, params) {
  const secure = secureContext(request);
  const cookies = parseCookies(request);
  const origin = publicOrigin(request);
  const fail = (code, ctx = {}) => {
    const headers = new Headers({
      ...SECURITY_HEADERS,
      location: oauthFailureLocation(code, {
        providerId: params.provider,
        returnTo: safeReturnTo(ctx.returnTo),
        intent: ctx.intent,
        mode: ctx.mode ?? null,
      }),
    });
    headers.append("set-cookie", clearOAuthCookie(secure));
    if (cookies[APPLE_USER_COOKIE]) headers.append("set-cookie", appleUserCookie("", secure, 0));
    return new Response(null, { status: 302, headers });
  };
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    let st = null;
    if (cookies.meridian_oauth) {
      try {
        st = openOAuthState(cookies.meridian_oauth);
      } catch (err) {
        return fail(err?.code ?? "OAUTH_STATE_INVALID");
      }
    }
    const ctx = st ? { returnTo: st.returnTo, intent: st.intent, mode: st.mode ?? null } : {};
    if (url.searchParams.get("error") || !code) return fail("OAUTH_CANCELLED", ctx);
    if (!st) return fail("OAUTH_STATE_INVALID");
    if (st.provider !== params.provider || st.state !== state) return fail("OAUTH_STATE_INVALID", ctx);
    let identity;
    try {
      identity = await resolveOAuthIdentity(
        params.provider,
        String(code),
        oauthRedirectUri(params.provider, origin),
        {
          nonce: st.nonce,
          codeVerifier: st.codeVerifier ?? null,
          appleUser: cookies[APPLE_USER_COOKIE] ?? null,
        },
      );
    } catch (err) {
      return fail(err?.code ?? "OAUTH_FAILED", ctx);
    }
    if (!identity.providerUserId) return fail("OAUTH_VERIFY_FAILED", ctx);
    try {
      const linking = st.intent === "link";
      const sess = linking ? await getSessionUser(request).catch(() => null) : null;
      const { user, created: accountCreated, linked, claimed } = await resolveOAuthAccount(identity, params.provider, {
        sessionUserId: sess?.user?.id ?? null,
        intent: linking ? "link" : "login",
      });
      const headers = new Headers({ ...SECURITY_HEADERS, location: safeReturnTo(st.returnTo) });
      if (!linking) {
        await touchLogin(user._id);
        const session = await createSession(user._id, request, { method: params.provider });
        headers.append("set-cookie", session.cookie);
      }
      const notice = linked
        ? `linked:${params.provider}`
        : accountCreated || claimed
          ? `created:${params.provider}`
          : `signin:${params.provider}`;
      headers.append("set-cookie", authNoticeCookie(notice, secure));
      headers.append("set-cookie", clearOAuthCookie(secure));
      if (cookies[APPLE_USER_COOKIE]) headers.append("set-cookie", appleUserCookie("", secure, 0));
      return new Response(null, { status: 302, headers });
    } catch (err) {
      if (!err?.code) console.error(`[oauth] ${params.provider} account resolution failed:`, err?.message ?? err);
      return fail(err?.code ?? "OAUTH_FAILED", ctx);
    }
  } catch (err) {
    if (!err?.code) console.error("[oauth] callback failed:", err?.message ?? err);
    return fail(err?.code ?? "OAUTH_FAILED");
  }
}

export const Route = createFileRoute("/api/auth/$provider/callback")({
  server: {
    handlers: {
      GET: (ctx) => complete(ctx.request, ctx.params),
      POST: (ctx) => replayAsGet(ctx.request),
    },
  },
});
