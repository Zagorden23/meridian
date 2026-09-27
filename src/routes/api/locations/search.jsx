import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { searchCatalog } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/locations/search")({
  server: {
    handlers: apiRoute(
      {
        GET: async ({ url }) => {
          const q = (url.searchParams.get("q") ?? "").slice(0, 120);
          if (q.trim().length < 2) {
            throw Object.assign(new Error("Query must be at least 2 characters."), {
              status: 400, code: "QUERY_TOO_SHORT",
            });
          }
          return { data: await searchCatalog(q, { limit: 12 }), source: "meridian-geo" };
        },
      },
      { limit: 90 },
    ),
  },
});
