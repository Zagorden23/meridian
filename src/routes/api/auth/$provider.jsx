import { createFileRoute } from "@tanstack/react-router";
import { oauthCookie, safeReturnTo, secureContext, startOAuthUrl } from "@/lib/meridian/auth.js";
import { SECURITY_HEADERS, oauthFailureLocation } from "@/lib/meridian/auth-route.js";

// GET /api/auth/google|microsoft|apple|amazon[?intent=login|link&returnTo=/app/...&mode=signup]
export const Route = createFileRoute("/api/auth/$provider")({
  server: {
    handlers: {
      async GET({ request, params }) {
        const url = new URL(request.url);
        const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
        const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
        try {
          const { url: authUrl, sealed } = startOAuthUrl(params.provider, url.origin, intent, returnTo);
          const headers = new Headers({ ...SECURITY_HEADERS, location: authUrl });
          headers.append("set-cookie", oauthCookie(sealed, secureContext(request)));
          return new Response(null, { status: 302, headers });
        } catch (err) {
          // Honest failure: back to where the attempt began with a safe error
          // code and the intended destination intact, so the retry lands where
          // the user was headed. The signup/signin tab (mode) is preserved so a
          // failure during account creation doesn't drop the user on sign-in.
          if (!err?.code) console.error(`[oauth] ${params.provider} start failed:`, err?.message ?? err);
          const location = oauthFailureLocation(err?.code ?? "OAUTH_START_FAILED", {
            providerId: params.provider,
            returnTo,
            intent,
            mode: url.searchParams.get("mode"),
          });
          return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location } });
        }
      },
    },
  },
});
