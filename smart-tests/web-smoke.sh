#!/bin/bash
# The web smoke test's server (decisions.md 58): the app's release web build
# for the local stack, served by the dashboard's Worker with its headers and
# /api, as production serves it. Needs the local Supabase (npm run db:start).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/smart-tests/env.sh" || { echo "local Supabase is not running (npm run db:start)" >&2; exit 1; }
cd "$ROOT"
npm run export:web -w mobile -- development
npx tsx scripts/web-dev-vars.ts
cd apps/web
exec npx wrangler dev --port "${1:-${SMOKE_PORT:-8787}}"
