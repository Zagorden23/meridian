import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser } from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      async GET({ request }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) return sendData({ status: "unauthenticated", user: null, method: null });
          return sendData({ status: "authenticated", user: sess.user, method: sess.method });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
