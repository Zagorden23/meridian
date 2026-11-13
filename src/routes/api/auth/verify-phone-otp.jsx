import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp } from "@/lib/meridian/otp-flow.js";
import { httpError } from "@/lib/meridian/api-envelope.js";
import {
  createSession,
  normalizePhone,
  publicUser,
  touchLogin,
  validateName,
} from "@/lib/meridian/auth.js";
import { createUser, findUserByPhone, saveUser } from "@/lib/meridian/auth-storage.js";

export const Route = createFileRoute("/api/auth/verify-phone-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const phone = normalizePhone(body.phone, body.countryCode);
          await consumeOtp(request, phone, body.code, { channel: "phone", purpose: "auth" });
          let user = await findUserByPhone(phone, { includeSecrets: true });
          let created = false;
          const name = validateName(body.name);
          if (!user) {
            try {
              user = await createUser({
                phone,
                phoneVerified: true,
                ...(name ? { name } : {}),
                authProviders: [{ provider: "phone", providerUserId: phone }],
                lastLoginAt: new Date(),
              });
              created = true;
            } catch (err) {
              if (err?.isUniqueConflict || err?.code === 11000) {
                user = await findUserByPhone(phone, { includeSecrets: true });
                if (!user) throw err;
              } else {
                throw err;
              }
            }
          }
          if (!created && user) {
            if (user.accountStatus && user.accountStatus !== "active") {
              throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
            }
            user.phoneVerified = true;
            if (name && !user.name) user.name = name;
            if (!(user.authProviders ?? []).some((p) => p.provider === "phone")) {
              user.authProviders = [...(user.authProviders ?? []), { provider: "phone", providerUserId: phone }];
            }
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            user = await saveUser(user);
          }
          await touchLogin(user._id);
          const { cookie } = await createSession(user._id, request, { method: "phone" });
          return sendData({ user: publicUser(user), created, method: "phone" }, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
