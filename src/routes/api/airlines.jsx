import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { listAirlines } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/airlines")({
  server: {
    handlers: apiRoute({
      GET: async ({ url }) => ({
        data: await listAirlines({ countryId: url.searchParams.get("countryId") ?? undefined }),
        source: "meridian-geo",
      }),
    }),
  },
});
