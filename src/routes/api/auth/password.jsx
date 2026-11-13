import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { setPassword } from "@/lib/meridian/password-flow.js";

// POST /api/auth/password { currentPassword?, newPassword } — set or change the
// signed-in account's password. See setPassword for when the current password
// may be omitted (first password, or recovery from an emailed-code session).
export const Route = createFileRoute("/api/auth/password")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const { user, signedOut } = await setPassword(request, {
            currentPassword: body.currentPassword,
            newPassword: body.newPassword,
          });
          return sendData({ user, signedOut });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
