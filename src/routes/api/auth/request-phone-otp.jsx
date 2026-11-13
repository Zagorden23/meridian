import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { requestOtp } from "@/lib/meridian/otp-flow.js";
import { getSessionUser, normalizePhone, sendPhoneOtp } from "@/lib/meridian/auth.js";
import { userExistsWithPhone } from "@/lib/meridian/auth-storage.js";

export const Route = createFileRoute("/api/auth/request-phone-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const phone = normalizePhone(body.phone, body.countryCode);
          const purpose = body.purpose === "link_phone" ? "link_phone" : "auth";
          if (purpose === "link_phone") {
            const sess = await getSessionUser(request);
            if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
            if (await userExistsWithPhone(phone, { excludeUserId: sess.user.id })) {
              throw httpError(409, "PHONE_TAKEN", "Another Meridian account already uses this phone number.");
            }
          }
          const data = await requestOtp(
            request,
            phone,
            "phone",
            (code) => sendPhoneOtp(phone, code, { purpose }),
            { purpose },
          );
          return sendData(data);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
