import { createFileRoute } from "@tanstack/react-router";
import { oauthCookie, safeReturnTo, secureContext, startOAuthUrl } from "@/lib/meridian/auth.js";
import { SECURITY_HEADERS } from "@/lib/meridian/auth-route.js";

// GET /api/auth/google|microsoft|apple|amazon[?intent=login|link&returnTo=/app/...]
export const Route = createFileRoute("/api/auth/$provider")({
  server: {
    handlers: {
      async GET({ request, params }) {
        try {
          const url = new URL(request.url);
          const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
          const origin = url.origin;
          const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
          const { url: authUrl, sealed } = startOAuthUrl(params.provider, origin, intent, returnTo);
          const headers = new Headers({ ...SECURITY_HEADERS, location: authUrl });
          headers.append("set-cookie", oauthCookie(sealed, secureContext(request)));
          return new Response(null, { status: 302, headers });
        } catch (err) {
          // Honest failure: redirect back to /auth with a safe error code.
          const code = err?.code ?? "OAUTH_START_FAILED";
          return new Response(null, {
            status: 302,
            headers: { ...SECURITY_HEADERS, location: `/auth?error=${encodeURIComponent(code)}` },
          });
        }
      },
    },
  },
});
