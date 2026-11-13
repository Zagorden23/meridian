import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { consumeOtp } from "@/lib/meridian/otp-flow.js";
import { getSessionUser, normalizeEmail, publicUser } from "@/lib/meridian/auth.js";
import { findUserById, saveUser, userExistsWithEmail } from "@/lib/meridian/auth-storage.js";

const APPLE_RELAY = /@privaterelay\.appleid\.com$/i;

export const Route = createFileRoute("/api/auth/link-email")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
          const body = await readJson(request);
          const email = normalizeEmail(body.email);
          if (await userExistsWithEmail(email, { excludeUserId: sess.user.id })) {
            throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
          }
          await consumeOtp(request, email, body.code, { channel: "email", purpose: "link_email" });
          const user = await findUserById(sess.user.id, { includeSecrets: true });
          if (!user) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
          user.email = email;
          user.emailVerified = true;
          user.emailIsPrivateRelay = APPLE_RELAY.test(email);
          const providers = (user.authProviders ?? [])
            .filter((p) => p.provider !== "email")
            .map((p) => (p.provider === "password" ? { ...p, providerUserId: email, email } : p));
          providers.push({ provider: "email", providerUserId: email, email });
          user.authProviders = providers;
          user.updatedAt = new Date();
          let saved;
          try {
            saved = await saveUser(user);
          } catch (err) {
            if (err?.isUniqueConflict || err?.code === 11000) {
              throw httpError(409, "EMAIL_TAKEN", "An account with this email already exists.");
            }
            throw err;
          }
          return sendData({ user: publicUser(saved) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});