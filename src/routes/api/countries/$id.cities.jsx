import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getCountry, getCountryCities } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/countries/$id/cities")({
  server: {
    handlers: apiRoute({
      GET: async ({ params, url }) => {
        const country = await getCountry(params.id);
        if (!country) {
          throw Object.assign(new Error("Country not found."), { status: 404, code: "NOT_FOUND" });
        }
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
        return { data: await getCountryCities(country.id, limit), source: "meridian-geo" };
      },
    }),
  },
});
