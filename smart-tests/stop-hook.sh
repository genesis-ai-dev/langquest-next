#!/bin/bash
# Claude Code Stop hook (.claude/settings.json): when an agent turn changed
# app code since the last green run, walk the Jev journeys before the agent
# may finish. Only a product failure blocks (the agent is sent back with the
# failing checks). Anything that means "could not judge" is a visible warning,
# never a silent pass. SMART_HOOK_OFF=1 disables it.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${SMART_PORT:-8091}"
# Not under results/: Playwright empties its output directory on every run.
STATE="$ROOT/smart-tests/.hook"
input="$(cat)"

say() { node -e 'console.log(JSON.stringify({ systemMessage: process.argv[1] }))' "Jev journeys: $1"; exit 0; }
block() { node -e 'console.log(JSON.stringify({ decision: "block", reason: process.argv[1] }))' "$1"; exit 0; }

[ "${SMART_HOOK_OFF:-}" = 1 ] && exit 0
# A block already sent the agent back once for this stop; never loop.
printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true' && exit 0
cd "$ROOT" || exit 0
mkdir -p "$STATE"

# Content fingerprint of everything a journey exercises. Commits alone do not
# change it; docs-only turns never trigger a run.
files() { git ls-files -co --exclude-standard -- apps/mobile/src apps/mobile/modules apps/mobile/App.tsx \
  apps/mobile/index.ts packages/core/src packages/client/src smart-tests | grep -Ev '^smart-tests/(results|\.hook)/'; }
fingerprint="$(files | xargs shasum 2>/dev/null | shasum | cut -c1-40)"
[ "$fingerprint" = "$(cat "$STATE/green" 2>/dev/null)" ] && exit 0

[ -n "${OPENROUTER_API_KEY:-}${TEXT_MODEL_API_KEY:-}" ] || [ -f "$HOME/.bash_profile" ] \
  || say "skipped: no OPENROUTER_API_KEY / TYPESAFE_API_KEY (see smart-tests/README.md)."
curl -s -o /dev/null --max-time 3 http://127.0.0.1:54321/auth/v1/health \
  || say "skipped: local Supabase is not running (npm run db:start)."
if ! curl -s -o /dev/null --max-time 3 "http://localhost:$PORT"; then
  nohup npm run web -w mobile -- --port "$PORT" > "$STATE/web-server.log" 2>&1 &
  say "skipped this turn: started the journey web server on :$PORT (first bundle takes a minute or two). They run at the next turn end."
fi

# Metro's watcher lags edits by a few seconds; never test a stale bundle.
newest="$(files | xargs stat -f %m 2>/dev/null | sort -n | tail -1)"
wait=$(( 12 - ($(date +%s) - ${newest:-0}) ))
[ "$wait" -gt 0 ] && sleep "$wait"

log="$STATE/last-run.log"
SMART_PORT="$PORT" "$ROOT/smart-tests/run.sh" > "$log" 2>&1
code=$?
failures="$(grep -A12 '^\[outcome\] product_failure' "$log" | grep -E '^\[outcome\]|^  FAIL|^\[jev actions\]' | head -40)"
if [ -n "$failures" ]; then
  block "Jev journeys found a product failure after your changes. The device event log, blob store or server did not reach the outcome the journey requires. Fix the product (not the journey) and finish again. Full log: smart-tests/.hook/last-run.log

$failures"
fi
summary="$(grep -E '^\[outcome\]' "$log" | sed 's/^/  /')"
# Green only with verdicts in hand: an empty log is never a pass.
if [ "$code" -eq 0 ] && [ -n "$summary" ] && ! printf '%s' "$summary" | grep -qv '\] passed'; then
  echo "$fingerprint" > "$STATE/green"
  say "all passed.
$summary"
fi
reason="$(grep -m1 -E 'Error:|\[jev error\]' "$log" || echo 'see the log')"
say "could not judge this change (exit $code): $reason
$summary
Log: smart-tests/.hook/last-run.log"
