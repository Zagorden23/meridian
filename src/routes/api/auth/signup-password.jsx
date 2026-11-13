import { createFileRoute } from "@tanstack/react-router";
import { readJson } from "@/lib/meridian/api-route.js";
import { sendData, sendError } from "@/lib/meridian/auth-route.js";
import { signupWithPassword } from "@/lib/meridian/password-flow.js";

export const Route = createFileRoute("/api/auth/signup-password")({
  server: {
    handlers: {
      async POST({ request }) {
        try {
          const body = await readJson(request);
          const { cookie, ...data } = await signupWithPassword(request, {
            email: body.email,
            password: body.password,
            name: body.name,
          });
          return sendData(data, cookie ? { cookies: [cookie] } : undefined);
        } catch (err) { return sendError(err); }
      },
    },
  },
});
