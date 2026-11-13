import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { grokPwaPlugin } from "./scripts/grok-pwa-plugin.mjs";
import { appEnvPlugin } from "./scripts/app-env-plugin.mjs";
import { isMigrationFile } from "./scripts/migration-plan.mjs";

/** The files `src/lib/db.js` globs — same directory, same non-recursive scope. */
function hasGlobbedMigrations(root) {
  try {
    return readdirSync(join(root, "migrations")).some(isMigrationFile);
  } catch {
    return false;
  }
}

/**
 * This project is JS-only, but TanStack Start unconditionally appends a
 * TypeScript `Register` footer (`import type …` / `declare module …`) to
 * `src/routeTree.gen.js` whenever it (re)generates the route tree —
 * `disableTypes: true` only suppresses the generator's own type blocks, not
 * the Start footer (`routeTreeFileFooter` is forced to a function returning
 * the TS block in `@tanstack/start-plugin-core`). Vite's dev SSR module
 * runner cannot parse TS syntax inside a `.js` file, so the footer 500s
 * every dev request. Strip it in-memory at transform time: no disk writes,
 * so the generator's file watcher can never ping-pong.
 */
const ROUTE_TREE_ID_SUFFIX = "src/routeTree.gen.js";
const ROUTE_TREE_TS_ANCHOR = "import type { getRouter }";
const ROUTE_TREE_TS_PRAGMA = /^\s*\/\/\s*@ts-nocheck\s*$/;
function stripRouteTreeTs(code) {
  const at = code.indexOf(ROUTE_TREE_TS_ANCHOR);
  const cut = (at === -1 ? code : code.slice(0, at)).split("\n");
  const clean = cut.filter((line) => !ROUTE_TREE_TS_PRAGMA.test(line));
  return `${clean.join("\n").trimEnd()}\n`;
}
function routeTreeJsSanitizer() {
  return {
    name: "app:route-tree-js",
    enforce: "pre",
    transform(code, id) {
      const path = id.split("?")[0].replace(/\\/g, "/");
      if (!path.endsWith(ROUTE_TREE_ID_SUFFIX)) return undefined;
      const clean = stripRouteTreeTs(code);
      return clean === code ? undefined : { code: clean };
    },
  };
}

/**
 * Finish PGLite bootstrap during dev-server setup (before traffic). Vite awaits
 * async `configureServer` hooks. Production: `src/lib/db` kicks `ensureDbReady`
 * on import.
 *
 * Vite awaiting the hook puts this on time-to-first-render, so an app with no
 * migrations — no schema to apply — skips it entirely rather than paying for a
 * PGLite instance it never queries.
 */
function pgliteBootstrapPlugin() {
  return {
    name: "app-builder:pglite-bootstrap",
    apply: "serve",
    async configureServer(server) {
      if (!hasGlobbedMigrations(server.config.root)) return;
      try {
        const mod = await server.ssrLoadModule("/src/lib/db.js");
        if (typeof mod.ensureDbReady === "function") {
          await mod.ensureDbReady();
        }
      } catch (err) {
        console.error("[app-builder] DB bootstrap failed:", err);
        throw err;
      }
    },
  };
}

/**
 * Live-preview OAuth popup — handled HERE so the agent never has to create a
 * `/auth/popup` route (and cannot break it by scaffolding a React page that
 * paints the full app shell in the popup).
 *
 * `signIn` (client.jsx) opens `/auth/popup?providerId=…` in a top-level window.
 * This middleware runs before TanStack Start, calls `handleAuthPopupRequest`,
 * and returns the 302 / completion HTML. Deployed apps do not use the popup
 * (full-page OAuth redirect), so `apply: "serve"` is enough.
 */
function authPopupPlugin() {
  return {
    name: "app-builder:auth-popup",
    apply: "serve",
    configureServer(server) {
      // Register immediately (not in a returned post-hook) so we run BEFORE
      // TanStack Start / the SPA HTML fallback. A model-authored
      // `src/routes/auth/popup.jsx` React page must never win this path.
      server.middlewares.use(async (req, res, next) => {
        try {
          const rawUrl = req.url ?? "";
          const pathOnly = rawUrl.split("?", 1)[0] ?? "";
          if (pathOnly !== "/auth/popup") {
            next();
            return;
          }
          if ((req.method ?? "GET").toUpperCase() !== "GET") {
            res.statusCode = 405;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("Method Not Allowed");
            return;
          }

          const host = String(
            req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8080",
          );
          const proto = String(
            req.headers["x-forwarded-proto"] ??
              (req.socket?.encrypted ? "https" : "http"),
          );
          const requestHeaders = new Headers();
          for (const [key, value] of Object.entries(req.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const v of value) requestHeaders.append(key, v);
            } else {
              requestHeaders.set(key, value);
            }
          }
          // Ensure Host is the public preview host so Better Auth's dynamic
          // baseURL / redirect_uri match the popup origin.
          if (!requestHeaders.has("host")) requestHeaders.set("host", host);

          const request = new Request(`${proto}://${host}${rawUrl}`, {
            method: "GET",
            headers: requestHeaders,
          });

          const mod = await server.ssrLoadModule("/src/lib/auth/popup.server.jsx");
          const response = await mod.handleAuthPopupRequest(request);

          res.statusCode = response.status;
          // Preserve multiple Set-Cookie headers (OAuth state + session).
          const setCookies =
            typeof response.headers.getSetCookie === "function"
              ? response.headers.getSetCookie()
              : [];
          response.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });
          for (const cookie of setCookies) {
            res.appendHeader("set-cookie", cookie);
          }
          const body = Buffer.from(await response.arrayBuffer());
          res.end(body);
        } catch (err) {
          console.error("[app-builder] /auth/popup handler failed:", err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("content-type", "text/plain; charset=utf-8");
            res.end("auth popup failed");
          }
        }
      });
    },
  };
}

// `0.0.0.0:8080` is the live-preview contract — don't change host/port.
// The dev server starts once `src/router.jsx` and `src/routes/` exist.
export default defineConfig(({ command, isPreview }) => ({
  server: {
    host: "0.0.0.0",
    port: 8080,
    strictPort: true,
    watch: {
      ignored: ["**/.output/**", "**/.vercel/**", "**/dist/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    strictPort: true,
  },
  build: {
    // One CSS file in this app (`src/styles.css`, linked via `?url` in
    // `__root.jsx`). The SSR bundle and the client bundle hash asset names
    // independently, so a hashed name makes the SSR-rendered `<link>` point
    // at a file that only exists in the SSR staging dir (404 on node-server,
    // unstyled page). A stable name keeps both environments in agreement.
    rolldownOptions: {
      output: {
        assetFileNames: (info) =>
          info.name && info.name.endsWith(".css")
            ? "assets/styles.css"
            : undefined,
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    // First: strip the Start TS footer before anything reads the tree.
    routeTreeJsSanitizer(),
    pgliteBootstrapPlugin(),
    // Before tanstackStart so /auth/popup never falls through to the SPA.
    authPopupPlugin(),
    // Dev-only /__app-env, read by scripts/check-auth-invariant.mjs.
    appEnvPlugin(),
    // PWA head + ?install=1 tutorial page; runs before Start/Nitro.
    grokPwaPlugin(),
    tailwindcss(),
    tanstackStart({
      router: {
        generatedRouteTree: "routeTree.gen.js",
        disableTypes: true,
      },
    }),
    ...(command === "build" || isPreview
      ? [
          nitro({
            // Render (and any plain Node host) serves the Nitro node-server
            // build via `npm start`. Nitro v3 defaults serverDir to
            // false, so removing this silently unwires /?install=1 on deploys.
            preset: "node-server",
            serverDir: "./server",
          }),
        ]
      : []),
    viteReact(),
  ],
}));
