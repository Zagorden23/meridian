import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { signinWithPassword } from "@/lib/meridian/password-flow.js";

export const Route = createFileRoute("/api/auth/signin-password")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const { user, created, method, cookie } = await signinWithPassword(request, {
            email: body.email,
            password: body.password,
          });
          return sendData({ user, created, method }, { cookies: [cookie] });
        } catch (err) { return sendError(err); }
      },
    },
  },
});
