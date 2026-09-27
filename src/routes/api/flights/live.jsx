import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getLiveTraffic } from "@/lib/meridian/flight-providers.js";

export const Route = createFileRoute("/api/flights/live")({
  server: {
    handlers: apiRoute(
      {
        // Viewport-filtered live positions (OpenSky). Poll at most every ~15 s
        // per client; the frontend interpolates between updates.
        GET: async ({ url }) => {
          const num = (name) => {
            const v = url.searchParams.get(name);
            return v == null ? NaN : Number(v);
          };
          const bbox = { lamin: num("lamin"), lamax: num("lamax"), lomin: num("lomin"), lomax: num("lomax") };
          const traffic = await getLiveTraffic(
            [bbox.lamin, bbox.lamax, bbox.lomin, bbox.lomax].every(Number.isFinite) ? bbox : {},
          );
          return { data: traffic, source: traffic.source, fetchedAt: traffic.fetchedAt };
        },
      },
      { limit: 30 },
    ),
  },
});
