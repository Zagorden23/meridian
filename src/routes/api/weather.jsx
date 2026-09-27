import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getWeather } from "@/lib/meridian/weather-service.js";
import { validateLatLon } from "@/lib/meridian/geo-math.js";

export const Route = createFileRoute("/api/weather")({
  server: {
    handlers: apiRoute(
      {
        GET: async ({ url }) => {
          const lat = Number(url.searchParams.get("lat"));
          const lon = Number(url.searchParams.get("lon"));
          if (!validateLatLon(lat, lon)) {
            throw Object.assign(new Error("Invalid coordinates."), { status: 400, code: "INVALID_COORDS" });
          }
          const wx = await getWeather({ lat, lon });
          return { data: wx, source: wx.source, cached: wx.cached, fetchedAt: wx.fetchedAt };
        },
      },
      { limit: 60 },
    ),
  },
});
