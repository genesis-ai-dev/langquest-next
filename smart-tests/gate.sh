#!/bin/bash
# Ship gate: refuse to deploy unless every Jev journey passed on exactly this
# code. A green run from the Stop hook (same fingerprint) counts; otherwise
# the journeys run now. "Could not judge" is a refusal, never a pass.
# SMART_GATE_OFF=1 bypasses it, loudly.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$ROOT/smart-tests/.hook"
if [ "${SMART_GATE_OFF:-}" = 1 ]; then
  echo "!! ship gate BYPASSED (SMART_GATE_OFF=1): journeys did not gate this deploy." >&2
  exit 0
fi
mkdir -p "$STATE"
fingerprint="$("$ROOT/smart-tests/fingerprint.sh")"
if [ "$fingerprint" = "$(cat "$STATE/green" 2>/dev/null)" ]; then
  echo "ship gate: journeys already green for this code."
  exit 0
fi
source "$ROOT/smart-tests/env.sh" \
  || { echo "ship gate: local Supabase is not running (npm run db:start). Refusing to ship unjudged." >&2; exit 1; }
log="$STATE/gate-run.log"
echo "ship gate: running Jev journeys (log: $log)"
"$ROOT/smart-tests/run.sh" 2>&1 | tee "$log"
code=${PIPESTATUS[0]}
summary="$(grep -E '^\[outcome\]' "$log")"
if [ "$code" -eq 0 ] && [ -n "$summary" ] && ! printf '%s' "$summary" | grep -qv '\] passed'; then
  echo "$fingerprint" > "$STATE/green"
  echo "ship gate: all journeys passed."
  exit 0
fi
echo "ship gate: journeys did not all pass (exit $code). Refusing to ship." >&2
printf '%s\n' "$summary" >&2
exit 1
