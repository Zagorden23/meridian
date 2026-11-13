import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { getSessionUser } from "@/lib/meridian/auth-saved.js";
import { deleteSavedLocation } from "@/lib/meridian/auth-storage.js";

export const Route = createFileRoute("/api/saved/locations/$id")({
  server: {
    handlers: {
      async DELETE({ request, params }) {
        try {
          const sess = await getSessionUser(request);
          if (!sess) {
            const err = new Error("Sign in first.");
            err.status = 401; err.code = "SESSION_REQUIRED";
            throw err;
          }
          await deleteSavedLocation(params.id, sess.user.id);
          return sendData({ removed: true });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
