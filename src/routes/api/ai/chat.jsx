import { createFileRoute } from "@tanstack/react-router";
import { apiRoute, readJson } from "@/lib/meridian/api-route.js";
import { interpret } from "@/lib/meridian/ai-tools.js";

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: apiRoute(
      {
        POST: async ({ request }) => {
          const body = await readJson(request);
          const message = String(body.message ?? "").slice(0, 2000);
          if (!message.trim()) {
            throw Object.assign(new Error("Message is required."), { status: 400, code: "INVALID_MESSAGE" });
          }
          const result = await interpret(message, body.context ?? {});
          return { data: result, source: "meridian-ai" };
        },
      },
      { limit: 30 },
    ),
  },
});
