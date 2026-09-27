import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getAirport } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/airports/$id")({
  server: {
    handlers: apiRoute({
      GET: async ({ params }) => {
        const airport = await getAirport(params.id);
        if (!airport) {
          throw Object.assign(new Error("Airport not found."), { status: 404, code: "NOT_FOUND" });
        }
        return { data: airport, source: "meridian-geo" };
      },
    }),
  },
});
