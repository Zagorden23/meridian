import { createFileRoute } from "@tanstack/react-router";
import { apiRoute, readJson } from "@/lib/meridian/api-route.js";
import { getAirport } from "@/lib/meridian/geo-repository.js";
import { searchFlights } from "@/lib/meridian/flight-providers.js";

export const Route = createFileRoute("/api/flights/search")({
  server: {
    handlers: apiRoute(
      {
        POST: async ({ request }) => {
          const body = await readJson(request);
          // Backend enforces domestic/international country rules (never trust UI).
          if (body.tripType === "domestic" || body.tripType === "international") {
            const [origin, destination] = await Promise.all([
              getAirport(body.originAirport),
              getAirport(body.destinationAirport),
            ]);
            if (!origin || !destination) {
              throw Object.assign(new Error("Unknown origin or destination airport."), {
                status: 400, code: "UNKNOWN_AIRPORT",
              });
            }
            const originCountry = origin.countryId ?? origin.country_id ?? null;
            const destCountry = destination.countryId ?? destination.country_id ?? null;
            const same = originCountry && originCountry === destCountry;
            if (body.tripType === "domestic" && !same) {
              throw Object.assign(
                new Error("Domestic flights require origin and destination in the same country."),
                { status: 400, code: "DOMESTIC_COUNTRY_MISMATCH" },
              );
            }
            if (body.tripType === "international" && same) {
              throw Object.assign(
                new Error("International flights require different origin and destination countries."),
                { status: 400, code: "INTERNATIONAL_SAME_COUNTRY" },
              );
            }
            body.originCountry = originCountry;
            body.destinationCountry = destCountry;
          }
          // Provider adapter validates + queries (or explains unavailability).
          return { data: await searchFlights(body), source: "flight-provider" };
        },
      },
      { limit: 30 },
    ),
  },
});
