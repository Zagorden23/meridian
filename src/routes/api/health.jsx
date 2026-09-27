import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { dbSource } from "@/lib/db.js";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: apiRoute({
      GET: async () => ({
        data: {
          status: "ok",
          service: "meridian-api",
          db: dbSource,
          version: "meridian/0.1.0",
          time: new Date().toISOString(),
        },
        source: "meridian",
      }),
    }),
  },
});
