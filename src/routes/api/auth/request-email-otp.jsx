import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { requestOtp } from "@/lib/meridian/otp-flow.js";
import { normalizeEmail, sendEmailOtp } from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/request-email-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const email = normalizeEmail(body.email);
          const data = await requestOtp(request, email, "email", (code) => sendEmailOtp(email, code));
          return sendData(data);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
