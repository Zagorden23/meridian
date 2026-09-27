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
          if (!OAUTH_PROVIDERS[provider] && provider !== "email" && provider !== "phone") {
            const err = new Error("Unknown provider.");
            err.status = 400; err.code = "UNKNOWN_PROVIDER";
            throw err;
          }
          const user = await User().findById(sess.user.id);
          if (!user) {
            const err = new Error("Account not found.");
            err.status = 404; err.code = "NOT_FOUND";
            throw err;
          }
          const remaining = (user.authProviders ?? []).filter((p) => p.provider !== provider);
          const hasPasswordless = user.email || user.phone;
          if (remaining.length === 0 && !hasPasswordless) {
            const err = new Error("Keep at least one sign-in method.");
            err.status = 400; err.code = "LAST_PROVIDER";
            throw err;
          }
          user.authProviders = remaining;
          user.updatedAt = new Date();
          await user.save();
          return sendData({ user: publicUser(user) });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
