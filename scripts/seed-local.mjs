#!/usr/bin/env node
// Seed the RUNNING dev server's database (PGLite in-memory) via HTTP.
// The standalone import script can't reach that in-process DB, so seeding
// goes through /api/admin/seed which runs the same idempotent seedCurated().
// Usage: npm run db:seed   (dev server must be up on :8080)
const base = process.env.MERIDIAN_URL ?? "http://127.0.0.1:8080";
const headers = { "content-type": "application/json" };
if (process.env.MERIDIAN_SEED_TOKEN) headers.authorization = `Bearer ${process.env.MERIDIAN_SEED_TOKEN}`;
try {
  const res = await fetch(`${base}/api/admin/seed`, { method: "POST", headers, body: "{}" });
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error("[db:seed] failed — is the dev server running?", err?.message ?? err);
  process.exit(1);
}
