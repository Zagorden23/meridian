import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { reverseGeocode } from "@/lib/meridian/geo-repository.js";
import { validateLatLon } from "@/lib/meridian/geo-math.js";

export const Route = createFileRoute("/api/locations/reverse")({
  server: {
    handlers: apiRoute({
      GET: async ({ url }) => {
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        if (!validateLatLon(lat, lon)) {
          throw Object.assign(new Error("Invalid coordinates."), { status: 400, code: "INVALID_COORDS" });
        }
        return { data: await reverseGeocode(lat, lon), source: "meridian-geo" };
      },
    }),
  },
});
