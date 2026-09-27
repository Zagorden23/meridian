import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getCountry, getCountryStates } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/countries/$id/states")({
  server: {
    handlers: apiRoute({
      GET: async ({ params }) => {
        const country = await getCountry(params.id);
        if (!country) {
          throw Object.assign(new Error("Country not found."), { status: 404, code: "NOT_FOUND" });
        }
        return { data: await getCountryStates(country.id), source: "meridian-geo" };
      },
    }),
  },
});
