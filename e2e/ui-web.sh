#!/bin/bash
# The UI suite's default server (decisions.md 102): the release export of the
# local stack, served by the app's Worker with its headers and /api, as
# production serves it. Same build as web-smoke.sh. Needs the local Supabase.
# The export bakes in the page's own origin for /api, so any port works.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/e2e/env.sh" || { echo "local Supabase is not running (npm run db:start)" >&2; exit 1; }
cd "$ROOT"
# The model is left out: the test microphones are tones, which split as they always have only without it (decision 135).
NO_SPEECH_MODEL=1 npm run export:web -w mobile -- development
npx tsx scripts/web-dev-vars.ts
cd apps/web
# No job container: the UI tests never fire the job tick (the local Edge pass
# projects, scripts/local-db.mjs), and building its image would need the job
# bundles and Docker (decisions.md 141).
exec npx wrangler dev --port "${1:-${UI_PORT:-8787}}" --enable-containers=false
