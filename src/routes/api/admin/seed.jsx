import { createFileRoute } from "@tanstack/react-router";
import { apiRoute } from "@/lib/meridian/api-route.js";
import { dbSource, getSql } from "@/lib/db.js";
import { logIngestion, seedCurated } from "@/lib/meridian/seed.js";

export const Route = createFileRoute("/api/admin/seed")({
  server: {
    handlers: apiRoute(
      {
        // Local/PGLite seeding without a token; everywhere else requires
        // MERIDIAN_SEED_TOKEN so production data can't be rewritten by visitors.
        POST: async ({ request }) => {
          const expected = process.env.MERIDIAN_SEED_TOKEN;
          const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
          if (dbSource !== "pglite" && (!expected || provided !== expected)) {
            throw Object.assign(new Error("Seeding is not allowed here."), { status: 403, code: "FORBIDDEN" });
          }
          const sql = await getSql();
          const counts = await seedCurated(sql.query);
          const total = Object.values(counts).reduce((a, b) => a + b, 0);
          await logIngestion(sql.query, "meridian-curated", "admin/seed", total);
          return { data: { counts, total }, source: "meridian-geo" };
        },
      },
      { limit: 5, windowMs: 60_000 },
    ),
  },
});
