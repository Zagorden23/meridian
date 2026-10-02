#!/bin/sh
# MERIDIAN dev-server bootstrap. Portable across the sandbox (/workspace) and
# local checkouts — resolves its own directory instead of hard-coding a path.
set -eu
cd "$(dirname "$0")"
# :8081 is QA-only — a revive must never inherit a stale built-output preview.
# Called directly, not via npm: no node_modules needed, so nothing to wait for.
node scripts/preview.mjs stop >/dev/null 2>&1 || true
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
