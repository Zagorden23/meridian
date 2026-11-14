import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { formatOffset, isDaytime, localTime, sunTimes, utcOffsetMinutes } from "@/lib/meridian/timezone.js";
import { validateLatLon } from "@/lib/meridian/geo-math.js";
import { reverseGeocode } from "@/lib/meridian/geo-repository.js";

export const Route = createFileRoute("/api/timezone")({
  server: {
    handlers: apiRoute({
      GET: async ({ url }) => {
        const lat = Number(url.searchParams.get("lat"));
        const lon = Number(url.searchParams.get("lon"));
        let tz = url.searchParams.get("tz") || url.searchParams.get("timezone") || undefined;
        if (!validateLatLon(lat, lon)) {
          throw Object.assign(new Error("Invalid coordinates."), { status: 400, code: "INVALID_COORDS" });
        }
        if (!tz) {
          try {
            const rev = await reverseGeocode(lat, lon);
            tz = rev?.nearestCity?.timezone || rev?.nearestAirport?.timezone || undefined;
          } catch {
            // Keep solar calculations working even if catalog lookup fails
          }
        }
        const offset = tz ? utcOffsetMinutes(tz) : null;
        return {
          data: {
            timezone: tz ?? null,
            localTime: tz ? localTime(tz) : null,
            utcOffset: formatOffset(offset),
            ...sunTimes(lat, lon),
            isDaytime: isDaytime(lat, lon),
          },
          source: "meridian",
        };
      },
    }),
  },
});
