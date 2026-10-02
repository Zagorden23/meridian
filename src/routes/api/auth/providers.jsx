import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { emailConfigured, passwordConfigured, providerStatus, smsConfigured } from "@/lib/meridian/auth.js";

// Public capability map — flags only, never secrets. The auth UI renders
// configured providers as live buttons and unconfigured ones as disabled
// with their missing-variable hint.
export const Route = createFileRoute("/api/auth/providers")({
  server: {
    handlers: {
      async GET() {
        try {
          return sendData({
            oauth: providerStatus(),
            password: {
              configured: passwordConfigured(),
              missing: passwordConfigured() ? [] : ["MONGODB_URI"],
            },
            emailOtp: {
              configured: emailConfigured(),
              missing: emailConfigured() ? [] : ["EMAIL_PROVIDER_KEY", "EMAIL_FROM"],
            },
            phoneOtp: {
              configured: smsConfigured(),
              missing: smsConfigured() ? [] : ["SMS_PROVIDER_KEY", "SMS_PROVIDER_SECRET", "SMS_FROM"],
            },
            mongo: { configured: Boolean(process.env.MONGODB_URI) },
          });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
