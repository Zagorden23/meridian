import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { forgotPassword } from "@/lib/meridian/password-flow.js";

export const Route = createFileRoute("/api/auth/forgot-password")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const data = await forgotPassword(request, body);
          return sendData(data);
        } catch (err) { return sendError(err); }
      },
    },
  },
});