import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { listAirports } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/airports")({
  server: {
    handlers: apiRoute({
      GET: async ({ url }) => ({
        data: await listAirports({
          countryId: url.searchParams.get("countryId") ?? undefined,
          cityId: url.searchParams.get("cityId") ?? undefined,
          limit: Math.min(Number(url.searchParams.get("limit")) || 100, 200),
        }),
        source: "meridian-geo",
      }),
    }),
  },
});
