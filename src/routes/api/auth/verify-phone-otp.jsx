import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp, requireMongo } from "@/lib/meridian/otp-flow.js";
import { connectMongo } from "@/lib/meridian/mongo.js";
import { httpError } from "@/lib/meridian/api-envelope.js";
import {
  User, createSession, ensureAuthIndexes, normalizePhone,
  publicUser, touchLogin, validateName,
} from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/verify-phone-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          requireMongo();
          const body = await readJson(request);
          const phone = normalizePhone(body.phone, body.countryCode);
          await consumeOtp(request, phone, body.code);
          await connectMongo();
          await ensureAuthIndexes().catch(() => {});
          let user = await User().findOne({ phone }).select("+passwordHash +passwordSalt");
          let created = false;
          const name = validateName(body.name);
          if (!user) {
            user = await User().create({
              phone, phoneVerified: true,
              ...(name ? { name } : {}),
              authProviders: [{ provider: "phone", providerUserId: phone }],
              lastLoginAt: new Date(),
            });
            created = true;
          } else {
            if (user.accountStatus !== "active") throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
            user.phoneVerified = true;
            if (name && !user.name) user.name = name;
            if (!(user.authProviders ?? []).some((p) => p.provider === "phone")) {
              user.authProviders.push({ provider: "phone", providerUserId: phone });
            }
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            await user.save();
          }
          await touchLogin(user._id);
          const { cookie } = await createSession(user._id, request, { method: "phone" });
          return sendData({ user: publicUser(user), created, method: "phone" }, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
