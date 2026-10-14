#!/bin/bash
# The UI suite's default server (decisions.md 102): the release export of the
# local stack, served by the dashboard's Worker with its headers and /api, as
# production serves it. Same build as web-smoke.sh. Needs the local Supabase.
# The export bakes in the page's own origin for /api, so any port works.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/web-tests/env.sh" || { echo "local Supabase is not running (npm run db:start)" >&2; exit 1; }
cd "$ROOT"
npm run export:web -w mobile -- development
npx tsx scripts/web-dev-vars.ts
cd apps/web
exec npx wrangler dev --port "${1:-${UI_PORT:-8787}}"
