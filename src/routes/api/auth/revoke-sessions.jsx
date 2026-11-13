import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser, revokeUserSessions } from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/revoke-sessions")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) throw httpError(401, "SESSION_REQUIRED", "Sign in first.");
          const signedOut = await revokeUserSessions(sess.user.id, { exceptSessionId: sess.sessionId });
          return sendData({ signedOut });
        } catch (err) { return sendError(err); }
      },
    },
  },
});