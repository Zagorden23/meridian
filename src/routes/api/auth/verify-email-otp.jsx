import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp, requireMongo } from "@/lib/meridian/otp-flow.js";
import { connectMongo } from "@/lib/meridian/mongo.js";
import { httpError } from "@/lib/meridian/api-envelope.js";
import {
  User, claimUnverifiedAccount, createSession, ensureAuthIndexes, normalizeEmail,
  publicUser, revokeUserSessions, touchLogin, validateName,
} from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/verify-email-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          requireMongo();
          const body = await readJson(request);
          const email = normalizeEmail(body.email);
          await consumeOtp(request, email, body.code);
          await connectMongo();
          await ensureAuthIndexes().catch(() => {});
          let user = await User().findOne({ email }).select("+passwordHash +passwordSalt");
          let created = false;
          let claimed = false;
          const name = validateName(body.name);
          if (!user) {
            user = await User().create({
              email, emailVerified: true,
              ...(name ? { name } : {}),
              authProviders: [{ provider: "email", providerUserId: email, email }],
              lastLoginAt: new Date(),
            });
            created = true;
          } else {
            if (user.accountStatus !== "active") throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
            if (!user.emailVerified) {
              // First proof of this mailbox. Whatever was attached before it —
              // a sign-up password, a linked provider — may not be this
              // person's, so it goes, and every other session is signed out.
              claimUnverifiedAccount(user, { provider: "email", providerUserId: email, email });
              claimed = true;
            } else if (!(user.authProviders ?? []).some((p) => p.provider === "email")) {
              user.authProviders.push({ provider: "email", providerUserId: email, email });
            }
            if (name && !user.name) user.name = name;
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            await user.save();
            if (claimed) await revokeUserSessions(user._id);
          }
          await touchLogin(user._id);
          const { cookie } = await createSession(user._id, request, { method: "email" });
          return sendData({ user: publicUser(user), created, claimed, method: "email" }, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
