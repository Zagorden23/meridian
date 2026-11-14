// Minimal .env loader — server-only, no dependencies.
//
// Why this exists: Vite exposes only VITE_* to the browser, and hosting
// dashboards inject real env vars in production. Locally, developers follow
// README (`cp .env.example .env`) and expect the server (`process.env` in
// TanStack Start / Nitro routes) to see those values. Without this loader,
// GOOGLE_CLIENT_ID etc. set in `.env` are invisible to `auth.js`, so OAuth
// buttons stay stuck on "setup needed" even after the developer configured
// everything correctly.
//
// Behavior:
// - Reads `.env` then `.env.local` from the project root (cwd), if present.
// - Never overwrites a real environment variable — hosting dashboards win.
// - Handles `KEY=VALUE`, quoted values, `export KEY=VALUE`, `#` comments.
// - Apple private keys stored as single-line `\n`-escaped values keep working
//   (`auth.js` converts `\n` back to real newlines before use).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function parseDotEnv(text) {
  const out = {};
  for (const rawLine of String(text ?? "").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = cleaned.slice(eq + 1).trim();
    // Strip matching surrounding quotes (single, double, backtick).
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith("`") && value.endsWith("`")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadFile(root, name) {
  try {
    const path = join(root, name);
    if (!existsSync(path)) return {};
    return parseDotEnv(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const loadedKeys = new Set();

export function loadLocalEnv() {
  try {
    const root = process.cwd();
    const base = loadFile(root, ".env");
    const local = loadFile(root, ".env.local");
    const merged = { ...base, ...local };
    let applied = 0;
    for (const key of [...loadedKeys]) {
      if (!(key in merged)) {
        delete process.env[key];
        loadedKeys.delete(key);
      }
    }
    for (const [key, value] of Object.entries(merged)) {
      if (key === "NODE_ENV" && import.meta.env?.DEV) continue;
      if (process.env[key] === undefined || process.env[key] === "" || loadedKeys.has(key)) {
        if (value !== "") {
          process.env[key] = value;
          loadedKeys.add(key);
          applied += 1;
        } else if (loadedKeys.has(key)) {
          delete process.env[key];
          loadedKeys.delete(key);
        }
      }
    }
    return applied;
  } catch {
    return 0;
  }
}

// Auto-run on import so server routes pick up `.env` before reading credentials.
loadLocalEnv();
