#!/usr/bin/env node
// Seeds the running Meridian dev server's MongoDB catalog via HTTP.
const baseUrl = process.env.MERIDIAN_URL || "http://127.0.0.1:8080";
const headers = {};
if (process.env.MERIDIAN_SEED_TOKEN?.trim()) {
  headers.authorization = `Bearer ${process.env.MERIDIAN_SEED_TOKEN.trim()}`;
}

try {
  const res = await fetch(`${baseUrl}/api/admin/seed`, { method: "POST", headers });
  const text = await res.text();
  if (!res.ok) {
    console.error(`[seed-local] HTTP ${res.status}:`, text);
    process.exit(1);
  }
  console.log("[seed-local]", text);
} catch (err) {
  console.error("[seed-local] Is the dev server running?", err.message);
  process.exit(1);
}
