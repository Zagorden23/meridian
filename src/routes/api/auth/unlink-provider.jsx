import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser, OAUTH_PROVIDERS, publicUser, User } from "@/lib/meridian/auth.js";

// POST /api/auth/unlink-provider { provider } — authenticated users may
// detach a provider as long as another sign-in method remains.
export const Route = createFileRoute("/api/auth/unlink-provider")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) {
            const err = new Error("Sign in first.");
            err.status = 401; err.code = "SESSION_REQUIRED";
            throw err;
          }
          const body = await readJson(request);
          const provider = String(body.provider ?? "");
          if (!OAUTH_PROVIDERS[provider] && provider !== "email" && provider !== "phone" && provider !== "password") {
            const err = new Error("Unknown provider.");
            err.status = 400; err.code = "UNKNOWN_PROVIDER";
            throw err;
          }
          const user = await User().findById(sess.user.id).select("+passwordHash +passwordSalt");
          if (!user) {
            const err = new Error("Account not found.");
            err.status = 404; err.code = "NOT_FOUND";
            throw err;
          }
          const remaining = (user.authProviders ?? []).filter((p) => p.provider !== provider);
          // Commercial guard: never strand an account with zero ways back in.
          // A remaining OAuth/email/phone provider is enough; otherwise a
          // verified email/phone or a password credential must stay.
          const hasOtherMethod = remaining.length > 0
            || Boolean(user.passwordHash && provider !== "password")
            || Boolean(user.emailVerified && provider !== "email")
            || Boolean(user.phoneVerified && provider !== "phone");
          if (!hasOtherMethod) {
            const err = new Error("Keep at least one sign-in method.");
            err.status = 400; err.code = "LAST_PROVIDER";
            throw err;
          }
          user.authProviders = remaining;
          if (provider === "password") {
            user.passwordHash = undefined;
            user.passwordSalt = undefined;
          }
          user.updatedAt = new Date();
          await user.save();
          return sendData({ user: publicUser(user) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
