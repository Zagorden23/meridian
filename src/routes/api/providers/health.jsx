import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { providerCoverage } from "@/lib/meridian/flight-providers.js";
import { dbSource, getSql } from "@/lib/db.js";
import { mongoStatus } from "@/lib/meridian/mongo.js";

export const Route = createFileRoute("/api/providers/health")({
  server: {
    handlers: apiRoute({
      GET: async () => {
        let db = "unreachable";
        try {
          const sql = await getSql();
          await sql.query("SELECT 1");
          db = dbSource;
        } catch {
          db = "unreachable";
        }
        return {
          data: { db, mongo: mongoStatus(), flights: providerCoverage(), weather: { provider: "open-meteo", keyless: true } },
          source: "meridian",
        };
      },
    }),
  },
});
