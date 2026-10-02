import { createFileRoute } from "@tanstack/react-router";
import { oauthCookie, safeReturnTo, secureContext, startOAuthUrl } from "@/lib/meridian/auth.js";
import { SECURITY_HEADERS } from "@/lib/meridian/auth-route.js";

// GET /api/auth/google|microsoft|apple|amazon[?intent=login|link&returnTo=/app/...&mode=signup]
export const Route = createFileRoute("/api/auth/$provider")({
  server: {
    handlers: {
      async GET({ request, params }) {
        const url = new URL(request.url);
        try {
          const intent = url.searchParams.get("intent") === "link" ? "link" : "login";
          const origin = url.origin;
          const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
          const { url: authUrl, sealed } = startOAuthUrl(params.provider, origin, intent, returnTo);
          const headers = new Headers({ ...SECURITY_HEADERS, location: authUrl });
          headers.append("set-cookie", oauthCookie(sealed, secureContext(request)));
          return new Response(null, { status: 302, headers });
        } catch (err) {
          // Honest failure: redirect back to /auth with a safe error code and
          // the intended destination intact, so the retry lands where the user
          // was headed. The signup/signin tab (mode) is preserved so a failure
          // during account creation doesn't drop the user back on sign-in.
          const code = err?.code ?? "OAUTH_START_FAILED";
          const back = new URLSearchParams({ error: code });
          if (url.searchParams.get("mode") === "signup") back.set("mode", "signup");
          const back_ = safeReturnTo(url.searchParams.get("returnTo"));
          if (back_ !== "/app") back.set("returnTo", back_);
          return new Response(null, {
            status: 302,
            headers: { ...SECURITY_HEADERS, location: `/auth?${back}` },
          });
        }
      },
    },
  },
});
