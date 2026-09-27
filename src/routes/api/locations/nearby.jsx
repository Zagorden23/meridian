import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { nearby, poisNearby } from "@/lib/meridian/geo-repository.js";
import { validateLatLon } from "@/lib/meridian/geo-math.js";

export const Route = createFileRoute("/api/locations/nearby")({
  server: {
    handlers: apiRoute({
      GET: async ({ url }) => {
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        if (!validateLatLon(lat, lon)) {
          throw Object.assign(new Error("Invalid coordinates."), { status: 400, code: "INVALID_COORDS" });
        }
        const radiusKm = Math.min(Number(url.searchParams.get("radiusKm")) || 100, 500);
        const category = url.searchParams.get("category") ?? undefined;
        const [cities, pois] = await Promise.all([
          nearby(lat, lon, radiusKm, { limit: 12 }),
          poisNearby(lat, lon, Math.min(radiusKm, 50), { category, limit: 12 }),
        ]);
        return { data: { cities, pois }, source: "meridian-geo" };
      },
    }),
  },
});
