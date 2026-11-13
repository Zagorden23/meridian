import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp } from "@/lib/meridian/otp-flow.js";
import { getSessionUser, normalizePhone, publicUser } from "@/lib/meridian/auth.js";
import { findUserById, saveUser, userExistsWithPhone } from "@/lib/meridian/auth-storage.js";

export const Route = createFileRoute("/api/auth/link-phone")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
          const body = await readJson(request);
          const phone = normalizePhone(body.phone, body.countryCode);
          if (await userExistsWithPhone(phone, { excludeUserId: sess.user.id })) {
            throw httpError(409, "PHONE_TAKEN", "Another Meridian account already uses this phone number.");
          }
          await consumeOtp(request, phone, body.code, { channel: "phone", purpose: "link_phone" });
          const user = await findUserById(sess.user.id, { includeSecrets: true });
          if (!user) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
          user.phone = phone;
          user.phoneVerified = true;
          const providers = (user.authProviders ?? []).filter((p) => p.provider !== "phone");
          providers.push({ provider: "phone", providerUserId: phone });
          user.authProviders = providers;
          user.updatedAt = new Date();
          let saved;
          try {
            saved = await saveUser(user);
          } catch (err) {
            if (err?.isUniqueConflict || err?.code === 11000) {
              throw httpError(409, "PHONE_TAKEN", "Another Meridian account already uses this phone number.");
            }
            throw err;
          }
          return sendData({ user: publicUser(saved) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});