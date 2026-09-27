import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { destroySession } from "@/lib/meridian/auth.js";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const cleared = await destroySession(request);
          return sendData({ status: "unauthenticated" }, { cookies: [cleared] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
