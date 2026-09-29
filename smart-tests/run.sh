#!/bin/bash
# Run the Jev journeys locally. Keys come from the same places the Jev MCP
# launcher reads (~/.bash_profile and the jev-ultrafast .env); server config
# comes from the running local Supabase (env.sh). Nothing secret is stored in this repo.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile" >/dev/null 2>&1 || true
JEV_ENV="${JEV_ENV_FILE:-$HOME/prototypes/jev-ultrafast/.env}"
set -a
[ -f "$JEV_ENV" ] && source "$JEV_ENV"
set +a
source "$ROOT/smart-tests/env.sh" || { echo "local Supabase is not running (npm run db:start)" >&2; exit 1; }
export TEXT_MODEL_API_KEY="${TEXT_MODEL_API_KEY:-${OPENROUTER_API_KEY:-}}"
export TEXT_MODEL_BASE_URL="${TEXT_MODEL_BASE_URL:-https://openrouter.ai/api/v1}"
export TEXT_MODEL="${TEXT_MODEL:-inception/mercury-2.5}"
export TEXT_MODEL_REASONING="${TEXT_MODEL_REASONING:-none}"
[ -x "$ROOT/smart-tests/.venv/bin/python" ] || (cd "$ROOT/smart-tests" && "${UV:-$HOME/.local/bin/uv}" sync)
cd "$ROOT"
exec npx playwright test -c smart-tests/playwright.config.ts "$@"
