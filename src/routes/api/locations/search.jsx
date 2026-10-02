import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { searchCatalog } from "@/lib/meridian/geo-repository.js";
import { parseCoordinateQuery } from "@/lib/meridian/geo-math.js";
import { forwardGeocode } from "@/lib/meridian/geocoding-service.js";

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

          // 1. "28.6139,77.2090" or DMS → coordinate hit, no catalog lookup.
          const coord = parseCoordinateQuery(q);
          if (coord) {
            return {
              data: [{
                kind: "COORDINATES",
                id: `${coord.lat.toFixed(5)},${coord.lon.toFixed(5)}`,
                name: `${coord.lat.toFixed(4)}, ${coord.lon.toFixed(4)}`,
                latitude: coord.lat,
                longitude: coord.lon,
                format: coord.format,
              }],
              source: "meridian-coords",
            };
          }

          // 2. Named places: local catalog, then worldwide online geocoder.
          const local = await searchCatalog(q, { limit: 12 });
          if (local.length >= 12) return { data: local, source: "meridian-geo" };
          let data = local;
          try {
            const online = await forwardGeocode(q);
            const seen = new Set(local.map((r) => String(r.name).toLowerCase()));
            data = [...local, ...online.filter((h) => !seen.has(h.name.toLowerCase()))].slice(0, 12);
          } catch {
            data = local; // provider down ≠ broken search
          }
          return { data, source: local.length ? "meridian-geo+geonames" : "geonames" };
        },
      },
      { limit: 90 },
    ),
  },
});
