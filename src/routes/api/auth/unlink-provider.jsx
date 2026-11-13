import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser, OAUTH_PROVIDERS, publicUser } from "@/lib/meridian/auth.js";
import { findUserById, saveUser } from "@/lib/meridian/auth-storage.js";

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
          const user = await findUserById(sess.user.id, { includeSecrets: true });
          if (!user) {
            const err = new Error("Account not found.");
            err.status = 404; err.code = "NOT_FOUND";
            throw err;
          }
          const remaining = (user.authProviders ?? []).filter((p) => p.provider !== provider);
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
            user.passwordUpdatedAt = undefined;
          }
          user.updatedAt = new Date();
          const saved = await saveUser(user);
          return sendData({ user: publicUser(saved) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
