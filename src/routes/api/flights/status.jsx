import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { getFlightStatus, parseFlightNumber, providerCoverage } from "@/lib/meridian/flight-providers.js";

export const Route = createFileRoute("/api/flights/status")({
  server: {
    handlers: apiRoute(
      {
        GET: async ({ url }) => {
          const raw = url.searchParams.get("number") ?? url.searchParams.get("flightNumber") ?? "";
          const { normalized } = parseFlightNumber(raw);
          try {
            const status = await getFlightStatus(normalized);
            return { data: status, source: "flight-provider" };
          } catch (err) {
            if (err?.code === "PROVIDER_UNAVAILABLE") {
              return {
                data: {
                  flightNumber: normalized,
                  status: "UNKNOWN",
                  coverage: providerCoverage().flightStatus,
                },
                source: "meridian",
              };
            }
            throw err;
          }
        },
      },
      { limit: 60 },
    ),
  },
});
