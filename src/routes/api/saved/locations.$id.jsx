import { createFileRoute } from "@tanstack/react-router";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { connectMongo } from "@/lib/meridian/mongo.js";
import { getSessionUser, SavedLocationModel } from "@/lib/meridian/auth-saved.js";

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
          await connectMongo();
          await SavedLocationModel().deleteOne({ _id: params.id, userId: sess.user.id });
          return sendData({ removed: true });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
