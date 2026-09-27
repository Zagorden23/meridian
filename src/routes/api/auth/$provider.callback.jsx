import { createFileRoute } from "@tanstack/react-router";
import { SECURITY_HEADERS } from "@/lib/meridian/auth-route.js";
import {
  clearOAuthCookie, createSession, getSessionUser, openOAuthState,
  parseCookies, resolveOAuthAccount, resolveOAuthIdentity,
  safeReturnTo, secureContext, touchLogin,
} from "@/lib/meridian/auth.js";

// GET+POST /api/auth/:provider/callback (Apple uses form_post → POST).
// Success → session cookie + 302 to the sanitized pre-login destination.
// Failure → 302 to /auth?error=CODE with a safe, user-facing code
// (never stack traces or tokens).
async function complete(request, params) {
  const secure = secureContext(request);
  const fail = (code) => new Response(null, {
    status: 302,
    headers: {
      ...SECURITY_HEADERS,
      location: `/auth?error=${encodeURIComponent(code)}`,
      "set-cookie": clearOAuthCookie(secure),
    },
  });
  try {
    const url = new URL(request.url);
    let code = url.searchParams.get("code");
    let state = url.searchParams.get("state");
    let appleUser = null;
    if (request.method === "POST") {
      const form = await request.formData().catch(() => null);
      code = code ?? form?.get("code");
      state = state ?? form?.get("state");
      appleUser = form?.get("user") ?? null;
      if (form?.get("error") || form?.get("error_code")) return fail("OAUTH_CANCELLED");
    }
    if (url.searchParams.get("error") || !code) return fail("OAUTH_CANCELLED");
    const sealed = parseCookies(request).meridian_oauth;
    if (!sealed) return fail("OAUTH_STATE_INVALID");
    const st = openOAuthState(sealed);
    if (st.provider !== params.provider || st.state !== state) return fail("OAUTH_STATE_INVALID");
    const identity = await resolveOAuthIdentity(
      params.provider,
      String(code),
      `${url.origin}/api/auth/${params.provider}/callback`,
      { nonce: st.nonce, appleUser },
    );
    if (!identity.providerUserId) return fail("OAUTH_VERIFY_FAILED");
    const sess = st.intent === "link" ? await getSessionUser(request).catch(() => null) : null;
    const { user } = await resolveOAuthAccount(identity, params.provider, sess?.user?.id ?? null);
    await touchLogin(user._id);
    const created = await createSession(user._id, request);
    const headers = new Headers({
      ...SECURITY_HEADERS,
      location: st.intent === "link" ? "/app?linked=1" : safeReturnTo(st.returnTo),
    });
    headers.append("set-cookie", created.cookie);
    headers.append("set-cookie", clearOAuthCookie(secure));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return fail(err?.code ?? "OAUTH_FAILED");
  }
}

export const Route = createFileRoute("/api/auth/$provider/callback")({
  server: {
    handlers: {
      GET: (ctx) => complete(ctx.request, ctx.params),
      POST: (ctx) => complete(ctx.request, ctx.params),
    },
  },
});
