import { createFileRoute } from "@tanstack/react-router";
import { oauthCookie, publicOrigin, safeReturnTo, secureContext, startOAuthUrl } from "@/lib/meridian/auth.js";
import { SECURITY_HEADERS, oauthFailureLocation } from "@/lib/meridian/auth-route.js";

// GET /api/auth/google|microsoft|apple|amazon[?intent=login|link&returnTo=/app/...&mode=signup]
export const Route = createFileRoute("/api/auth/$provider")({
  server: {
    handlers: {
      async GET({ request, params }) {
        const url = new URL(request.url);
        const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
        const mode = url.searchParams.get("mode") === "signup" ? "signup" : null;
        const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
        try {
          const origin = publicOrigin(request);
          const { url: authUrl, sealed } = startOAuthUrl(params.provider, origin, intent, returnTo, { mode });
          const headers = new Headers({ ...SECURITY_HEADERS, location: authUrl });
          headers.append("set-cookie", oauthCookie(sealed, secureContext(request)));
          return new Response(null, { status: 302, headers });
        } catch (err) {
          if (!err?.code) console.error(`[oauth] ${params.provider} start failed:`, err?.message ?? err);
          const location = oauthFailureLocation(err?.code ?? "OAUTH_START_FAILED", {
            providerId: params.provider,
            returnTo,
            intent,
            mode,
          });
          return new Response(null, { status: 302, headers: { ...SECURITY_HEADERS, location } });
        }
      },
    },
  },
});
