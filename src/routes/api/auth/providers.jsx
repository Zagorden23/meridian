import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { emailConfigured, passwordConfigured, providerStatus, smsConfigured } from "@/lib/meridian/auth.js";

// Public capability map — flags only, never secrets. The auth UI renders
// configured methods as live controls.
//
// `diagnostics` is on everywhere except production. With it, each unconfigured
// method lists the environment variables it is waiting for and the UI shows a
// setup guide. In production those names are withheld and the UI simply omits
// what is not available: visitors should not be reading a deployment checklist.
// Operators get the same list once in the server log instead.
let warned = false;

export const Route = createFileRoute("/api/auth/providers")({
  server: {
    handlers: {
      async GET() {
        try {
          const diagnostics = process.env.NODE_ENV !== "production";
          const hint = (configured, missing) => ({
            configured,
            ...(diagnostics ? { missing: configured ? [] : missing } : {}),
          });
          const oauth = providerStatus();
          if (!diagnostics && !warned) {
            warned = true;
            const off = oauth.filter((p) => !p.configured).map((p) => `${p.id} (${p.missing.join(", ")})`);
            if (off.length) console.warn(`[auth] sign-in providers not configured: ${off.join("; ")}`);
            if (!emailConfigured()) console.warn("[auth] email codes not configured (EMAIL_PROVIDER_KEY, EMAIL_FROM)");
            if (!smsConfigured()) console.warn("[auth] SMS codes not configured (SMS_PROVIDER_KEY, SMS_PROVIDER_SECRET, SMS_FROM)");
            if (!passwordConfigured()) console.warn("[auth] accounts unavailable: MONGODB_URI is not set");
          }
          return sendData({
            diagnostics,
            oauth: oauth.map((p) => ({ id: p.id, label: p.label, ...hint(p.configured, p.missing) })),
            password: hint(passwordConfigured(), ["MONGODB_URI"]),
            emailOtp: hint(emailConfigured(), ["EMAIL_PROVIDER_KEY", "EMAIL_FROM"]),
            phoneOtp: hint(smsConfigured(), ["SMS_PROVIDER_KEY", "SMS_PROVIDER_SECRET", "SMS_FROM"]),
            mongo: { configured: passwordConfigured() },
          });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
