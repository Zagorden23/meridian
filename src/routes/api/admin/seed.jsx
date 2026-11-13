import { createFileRoute } from "@tanstack/react-router";
import { httpError } from "@/lib/meridian/api-envelope.js";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { SEED_SOURCE } from "@/lib/meridian/seed-data.js";
import { logIngestion, seedCurated } from "@/lib/meridian/seed.js";

export const Route = createFileRoute("/api/admin/seed")({
  server: {
    // Allows unauthenticated seeding in local development when MERIDIAN_SEED_TOKEN is unset;
    // production / Render deployments require MERIDIAN_SEED_TOKEN bearer auth.
    handlers: apiRoute({
      POST: async ({ request }) => {
        const expected = process.env.MERIDIAN_SEED_TOKEN?.trim();
        const isProd = process.env.NODE_ENV === "production" || process.env.RENDER === "true";
        const authHeader = request.headers.get("authorization") || "";
        const provided = authHeader.replace(/^Bearer\s+/i, "").trim();

        if (isProd || expected) {
          if (!expected || provided !== expected) {
            throw httpError(401, "UNAUTHORIZED", "Valid seed token required.");
          }
        }

        const counts = await seedCurated();
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        await logIngestion("curated", SEED_SOURCE, total);
        return { data: { seeded: counts }, source: "meridian-seed" };
      },
    }),
  },
});
