import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { OTP_TTL_MS, requestOtp } from "@/lib/meridian/otp-flow.js";
import {
  emailCanDeliver,
  getSessionUser,
  normalizeEmail,
  sendEmailOtp,
} from "@/lib/meridian/auth.js";
import { findUserByEmail, userExistsWithEmail } from "@/lib/meridian/auth-storage.js";

const PURPOSES = new Set(["auth", "verify_email", "link_email"]);

export const Route = createFileRoute("/api/auth/request-email-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const email = normalizeEmail(body.email);
          const purpose = PURPOSES.has(body.purpose) ? body.purpose : "auth";
          if (purpose === "link_email") {
            const sess = await getSessionUser(request);
            if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
            if (await userExistsWithEmail(email, { excludeUserId: sess.user.id })) {
              throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
            }
          }
          if (purpose === "verify_email") {
            if (!emailCanDeliver()) {
              throw httpError(
                503,
                "EMAIL_PROVIDER_UNCONFIGURED",
                "Email delivery is not configured on this server. Set EMAIL_PROVIDER_KEY and EMAIL_FROM.",
              );
            }
            const existing = await findUserByEmail(email);
            if (!existing || existing.emailVerified) {
              return sendData({
                channel: "email",
                purpose: "verify_email",
                expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
                resendInSeconds: 60,
              });
            }
          }
          const data = await requestOtp(
            request,
            email,
            "email",
            (code) => sendEmailOtp(email, code, { purpose }),
            { purpose },
          );
          return sendData(data);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
