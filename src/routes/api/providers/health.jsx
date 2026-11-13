import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { providerCoverage } from "@/lib/meridian/flight-providers.js";
import { mongoStatus, pingMongo } from "@/lib/meridian/mongo.js";

export const Route = createFileRoute("/api/providers/health")({
  server: {
    handlers: apiRoute({
      GET: async () => {
        let mongoPing = { ok: false, ...mongoStatus() };
        try {
          mongoPing = await pingMongo();
        } catch (err) {
          mongoPing = {
            ok: false,
            ...mongoStatus(),
            error: err?.message || "MongoDB connection failed",
          };
        }
        return {
          data: {
            db: "mongodb",
            mongo: mongoPing,
            flights: providerCoverage(),
            weather: {
              provider: (process.env.WEATHER_PROVIDER || "open-meteo").toLowerCase(),
              keyless: true,
            },
          },
          source: "meridian",
        };
      },
    }),
  },
});
