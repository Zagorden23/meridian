import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { resetPassword } from "@/lib/meridian/password-flow.js";

export const Route = createFileRoute("/api/auth/reset-password")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const { cookie, ...data } = await resetPassword(request, body);
          return sendData(data, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});