import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import {
  authBackend,
  emailCanDeliver,
  emailConfigured,
  isDevOtpSandbox,
  passwordConfigured,
  providerStatus,
  smsCanDeliver,
  smsConfigured,
} from "@/lib/meridian/auth.js";

// Public capability map — flags only, never secrets. The auth UI renders
// configured methods as live controls.
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
          }
          return sendData({
            diagnostics,
            oauth: oauth.map((p) => ({ id: p.id, label: p.label, ...hint(p.configured, p.missing) })),
            password: { ...hint(passwordConfigured(), []), backend: authBackend() },
            emailOtp: {
              ...hint(emailConfigured(), ["EMAIL_PROVIDER_KEY", "EMAIL_FROM"]),
              configured: emailCanDeliver(),
              providerConfigured: emailConfigured(),
              sandbox: isDevOtpSandbox() && !emailConfigured(),
            },
            phoneOtp: {
              ...hint(smsConfigured(), ["SMS_PROVIDER_KEY", "SMS_PROVIDER_SECRET", "SMS_FROM"]),
              configured: smsCanDeliver(),
              providerConfigured: smsConfigured(),
              sandbox: isDevOtpSandbox() && !smsConfigured(),
            },
            storage: { configured: passwordConfigured(), backend: authBackend() },
          });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
