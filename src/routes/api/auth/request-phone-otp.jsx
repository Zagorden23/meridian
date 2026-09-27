import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { requestOtp } from "@/lib/meridian/otp-flow.js";
import { normalizePhone, sendPhoneOtp } from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/request-phone-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const phone = normalizePhone(body.phone, body.countryCode);
          const data = await requestOtp(request, phone, "phone", (code) => sendPhoneOtp(phone, code));
          return sendData(data);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
