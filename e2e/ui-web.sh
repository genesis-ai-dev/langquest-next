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
# The projection pass runs in the job container, as on a hosted project, its
# tick fired every minute (decisions.md 148): the job bundles, Docker, and the
# local config copy, which reaches the database from the container and sends
# /__scheduled to the Worker.
node scripts/build-jobs.mjs
PORT="${1:-${UI_PORT:-8787}}"
cd apps/web
exec node ../../scripts/job-tick.mjs "$PORT" -- npx wrangler dev -c .wrangler.dev.jsonc --port "$PORT" --test-scheduled
