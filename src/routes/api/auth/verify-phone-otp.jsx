import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp, requireMongo } from "@/lib/meridian/otp-flow.js";
import { connectMongo } from "@/lib/meridian/mongo.js";
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
          if (!user) {
            user = await User().create({
              phone, phoneVerified: true,
              name: validateName(body.name) || null,
              authProviders: [{ provider: "phone", providerUserId: phone }],
              lastLoginAt: new Date(),
            });
            created = true;
          } else {
            user.phoneVerified = true;
            const nm = validateName(body.name);
            if (nm && !user.name) user.name = nm;
            if (!(user.authProviders ?? []).some((p) => p.provider === "phone")) {
              user.authProviders.push({ provider: "phone", providerUserId: phone });
            }
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            await user.save();
          }
          await touchLogin(user._id);
          const { cookie } = await createSession(user._id, request);
          return sendData({ user: publicUser(user), created }, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
