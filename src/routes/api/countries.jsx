import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { listCountries } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/countries")({
  server: {
    handlers: apiRoute({
      GET: async () => ({ data: await listCountries(), source: "meridian-geo" }),
    }),
  },
});
