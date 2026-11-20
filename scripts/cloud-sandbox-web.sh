#!/bin/bash
# Run the web UI tests in a cloud agent's sandbox (LAN-239). Two things differ there:
#  1. The sandbox's egress proxy re-signs HTTPS, and Supabase's edge-runtime container
#     does not trust it, so the `join` function cannot load @supabase/supabase-js and
#     every fixture world fails with "join as ...: Edge Function returned a non-2xx".
#     The fix is to fill the container's package cache from the host, where the
#     proxy's CA is trusted, using the `deno` npm package.
#  2. Docker Hub may answer 429, so the jobs container (apps/web/jobs) cannot build.
#     The app does not need it for UI tests: serve the Worker without `containers`.
# Needs: dockerd running (`dockerd &`), `npm install` done, `npm run db:start` done.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="${TMPDIR:-/tmp}/lq-deno-cache"
TOOLS="${TMPDIR:-/tmp}/lq-deno-bin"
CONTAINER=supabase_edge_runtime_langquest-next
CA="${SSL_CERT_FILE:-/root/.ccr/ca-bundle.crt}"
mkdir -p "$TOOLS" "$CACHE"
[ -x "$TOOLS/node_modules/.bin/deno" ] || (cd "$TOOLS" && npm init -y >/dev/null && npm i deno --no-audit --no-fund >/dev/null)
# A copy outside the repo, so deno does not use the repo's node_modules.
COPY="$(mktemp -d)"; cp -r "$ROOT/supabase/functions" "$COPY/"
for f in "$COPY"/functions/*/index.ts; do
  DENO_DIR="$CACHE" DENO_CERT="$CA" "$TOOLS/node_modules/.bin/deno" cache --node-modules-dir=none "$f"
done
docker cp "$CACHE/." "$CONTAINER:/root/.cache/deno/"
docker restart "$CONTAINER" >/dev/null
# Without the jobs container:
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$ROOT/apps/web/.wrangler.dev.jsonc','utf8'));delete d.containers;fs.writeFileSync('$ROOT/apps/web/.wrangler.noc.jsonc',JSON.stringify(d,null,1))"
echo "Now: bash e2e/export-web.sh && npx tsx scripts/web-dev-vars.ts, then in apps/web:"
echo "  npx wrangler dev -c .wrangler.noc.jsonc --port 8787 &"
echo "and run: npm run test:ui:web -- e2e/ui/<file>   (it reuses the server on :8787)"
