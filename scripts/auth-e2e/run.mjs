#!/usr/bin/env node
// End-to-end check of every sign-in method against the PRODUCTION build.
//
//   npm run build && npm run test:auth-e2e        (add -- --verbose for detail)
//
// Starts `.output/server/index.mjs` with stand-in credentials and a preload
// that answers for Google / Microsoft / Apple / Resend / Twilio, then drives
// the sign-in screen in headless Chromium: provider sign-in (including Apple's
// cross-site form POST), email codes, phone codes, password sign-up with email
// confirmation, and password reset. It needs no real credentials and sends
// nothing outside this machine; accounts go to a throwaway database that is
// dropped at the end. Requires MongoDB (MONGODB_URI, default local).
import "../../src/lib/meridian/load-env.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { exportPKCS8, generateKeyPair } from "jose";
import mongoose from "mongoose";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const entry = join(root, ".output/server/index.mjs");
if (!existsSync(entry)) {
  console.error("No production build found. Run `npm run build` first.");
  process.exit(1);
}

const PORT = process.env.AUTH_E2E_PORT || "8095";
const BASE = `http://127.0.0.1:${PORT}`;
const OUTBOX = join(tmpdir(), `meridian-auth-e2e-${process.pid}.json`);
const SHOTS = join(root, "screenshots");
mkdirSync(SHOTS, { recursive: true });

const mongoUri = new URL(process.env.MONGODB_URI?.trim() || "mongodb://127.0.0.1:27017/meridian");
mongoUri.pathname = `/meridian_auth_e2e_${process.pid}`;

// The Sign in with Apple key, stored the way hosting dashboards store it.
const appleKey = await generateKeyPair("ES256", { extractable: true });

const server = spawn(
  process.execPath,
  ["--import", pathToFileURL(join(here, "standin-providers.mjs")).href, entry],
  {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT,
      HOST: "127.0.0.1",
      APP_URL: "",
      AUTH_E2E_OUTBOX: OUTBOX,
      MONGODB_URI: mongoUri.toString(),
      SESSION_SECRET: "auth-e2e-session-secret-0123456789abcdef0123456789",
      GOOGLE_CLIENT_ID: "standin.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "standin-secret",
      MICROSOFT_CLIENT_ID: "standin-ms-client",
      MICROSOFT_CLIENT_SECRET: "standin-ms-secret",
      MICROSOFT_TENANT_ID: "common",
      APPLE_CLIENT_ID: "com.standin.web",
      APPLE_TEAM_ID: "TEAMSTANDIN",
      APPLE_KEY_ID: "KEYSTANDIN",
      APPLE_PRIVATE_KEY: (await exportPKCS8(appleKey.privateKey)).trim().replace(/\n/g, "\\n"),
      EMAIL_PROVIDER_KEY: "re_standin",
      EMAIL_FROM: "Meridian <noreply@meridian.example.com>",
      SMS_PROVIDER_KEY: `AC${"a".repeat(32)}`,
      SMS_PROVIDER_SECRET: "standin-token",
      SMS_VERIFY_SERVICE_SID: `VA${"b".repeat(32)}`,
      SMS_FROM: "",
    },
  },
);
let log = "";
server.stdout.on("data", (chunk) => { log += chunk; });
server.stderr.on("data", (chunk) => { log += chunk; });

async function cleanup() {
  server.kill();
  rmSync(OUTBOX, { force: true });
  try {
    const conn = await mongoose.createConnection(mongoUri.toString(), { serverSelectionTimeoutMS: 5000 }).asPromise();
    await conn.dropDatabase();
    await conn.close();
  } catch { /* nothing was created */ }
}

let up = false;
for (let i = 0; i < 60 && !up && server.exitCode === null; i += 1) {
  await new Promise((r) => setTimeout(r, 500));
  up = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false);
}
if (!up) {
  console.error(`The production server did not come up on ${BASE}:\n${log}`);
  await cleanup();
  process.exit(1);
}

const passthrough = process.argv.slice(2);
const runner = spawn(process.execPath, [join(here, "browser.mjs"), BASE, OUTBOX, SHOTS, ...passthrough], { stdio: "inherit" });
const code = await new Promise((done) => runner.on("exit", done));
await cleanup();

// A 5xx or crash during sign-in is a failure even if the browser recovered.
const serverErrors = log.split("\n").filter((line) => /INTERNAL_ERROR|unhandled|TypeError|ReferenceError/i.test(line));
if (serverErrors.length) console.log(`\nServer errors during the run:\n  ${serverErrors.slice(0, 10).join("\n  ")}`);
process.exit(code || (serverErrors.length ? 1 : 0));
