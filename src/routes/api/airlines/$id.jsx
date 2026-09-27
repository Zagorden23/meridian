import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getAirline } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/airlines/$id")({
  server: {
    handlers: apiRoute({
      GET: async ({ params }) => {
        const airline = await getAirline(params.id);
        if (!airline) {
          throw Object.assign(new Error("Airline not found."), { status: 404, code: "NOT_FOUND" });
        }
        return { data: airline, source: "meridian-geo" };
      },
    }),
  },
});
