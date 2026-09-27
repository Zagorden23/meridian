import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { listCapitals } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/capitals")({
  server: {
    handlers: apiRoute({
      GET: async () => ({ data: await listCapitals(), source: "meridian-geo" }),
    }),
  },
});
