// Post-build: ship PGLite's Emscripten assets with the Nitro bundle.
//
// The bundled `_libs/electric-sql__pglite.mjs` resolves `pglite.data` /
// `pglite.wasm` relative to its own directory (Emscripten's scriptDirectory).
// Nitro's bundle tracer cannot follow those runtime-resolved assets, so a
// fresh `npm run build` ships a server that throws ENOENT the moment the
// PGLite fallback (no DATABASE_URL) is touched. Copying the two files next to
// the bundle restores dev parity for the built output. A deployment with a
// real DATABASE_URL never loads this module and is unaffected either way.
import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dest = join(root, ".output", "server", "_libs");

let copied = 0;
for (const asset of ["pglite.data", "pglite.wasm", "initdb.wasm"]) {
  const from = join(src, asset);
  const to = join(dest, asset);
  if (!existsSync(from)) {
    console.warn(`[pglite-assets] missing ${asset} — is @electric-sql/pglite installed?`);
    continue;
  }
  if (existsSync(to)) {
    console.log(`[pglite-assets] ${asset} already present`);
    continue;
  }
  mkdirSync(dest, { recursive: true });
  copyFileSync(from, to);
  copied += 1;
  console.log(`[pglite-assets] copied ${asset}`);
}
if (copied === 0 && (!existsSync(join(dest, "pglite.data")) || !existsSync(join(dest, "initdb.wasm")))) {
  console.error("[pglite-assets] no assets were shipped — PGLite fallback will fail in the built output");
  process.exitCode = 1;
}
