import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp } from "@/lib/meridian/otp-flow.js";
import { httpError } from "@/lib/meridian/api-envelope.js";
import {
  claimUnverifiedAccount,
  createSession,
  normalizeEmail,
  publicUser,
  revokeUserSessions,
  touchLogin,
  validateName,
} from "@/lib/meridian/auth.js";
import { createUser, findUserByEmail, saveUser } from "@/lib/meridian/auth-storage.js";

export const Route = createFileRoute("/api/auth/verify-email-otp")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const email = normalizeEmail(body.email);
          const purpose = body.purpose === "verify_email" ? "verify_email" : "auth";
          await consumeOtp(request, email, body.code, { channel: "email", purpose });

          let user = await findUserByEmail(email, { includeSecrets: true });
          const name = validateName(body.name);

          if (purpose === "verify_email") {
            if (!user) {
              throw httpError(400, "OTP_NOT_FOUND", "No pending account found for this email.");
            }
            if (user.accountStatus && user.accountStatus !== "active") {
              throw httpError(403, "ACCOUNT_DISABLED", "This account is disabled.");
            }
            user.emailVerified = true;
            if (name && !user.name) user.name = name;
            const providers = [...(user.authProviders ?? [])];
            if (!providers.some((p) => p.provider === "email")) {
              providers.push({ provider: "email", providerUserId: email, email });
            }
            user.authProviders = providers;
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            user = await saveUser(user);
            await revokeUserSessions(user._id);
            const method = user.passwordHash ? "password" : "email";
            await touchLogin(user._id);
            const { cookie } = await createSession(user._id, request, { method });
            return sendData({ user: publicUser(user), created: false, verified: true, method }, { cookies: [cookie] });
          }

          let created = false;
          let claimed = false;
          if (!user) {
            try {
              user = await createUser({
                email,
                emailVerified: true,
                ...(name ? { name } : {}),
                authProviders: [{ provider: "email", providerUserId: email, email }],
                lastLoginAt: new Date(),
              });
              created = true;
            } catch (err) {
              if (err?.isUniqueConflict || err?.code === 11000) {
                user = await findUserByEmail(email, { includeSecrets: true });
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
            if (!user.emailVerified) {
              // First proof of this mailbox clears earlier unverified credentials.
              claimUnverifiedAccount(user, { provider: "email", providerUserId: email, email });
              claimed = true;
            } else if (!(user.authProviders ?? []).some((p) => p.provider === "email")) {
              user.authProviders = [...(user.authProviders ?? []), { provider: "email", providerUserId: email, email }];
            }
            if (name && !user.name) user.name = name;
            user.lastLoginAt = new Date();
            user.updatedAt = new Date();
            user = await saveUser(user);
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
