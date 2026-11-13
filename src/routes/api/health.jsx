import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { mongoStatus } from "@/lib/meridian/mongo.js";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: apiRoute({
      GET: async () => ({
        data: {
          status: "ok",
          service: "meridian-api",
          db: "mongodb",
          mongo: mongoStatus(),
          version: "meridian/0.1.0",
          time: new Date().toISOString(),
        },
        source: "meridian",
      }),
    }),
  },
});
