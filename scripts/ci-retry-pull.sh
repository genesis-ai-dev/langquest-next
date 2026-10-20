#!/bin/bash
# Run a command that pulls container images (supabase start, docker pull),
# and run it again when a registry turned it away: Docker Hub and ECR Public
# ration anonymous pulls per IP address, and a GitHub-hosted runner shares
# its address (toomanyrequests: Rate exceeded / Data limit exceeded, seen in
# guardrails runs 39360456537 and 39473313915). Any other failure ends it at
# once, so a broken migration is not run four times.
# A port someone else held as the stack started ("address already in use";
# scripts/ci-reserve-ports.sh keeps the stack's ports out of the outbound
# range, so this is a backstop) is retried too, after the containers go.
#
#   scripts/ci-retry-pull.sh npm run db:start
#
# Images already pulled stay, so each attempt has less to fetch. Waits 30,
# 60 and 120 s between the four attempts.
set -uo pipefail
[ "$#" -gt 0 ] || { echo "usage: ci-retry-pull.sh <command...>" >&2; exit 2; }
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for attempt in 1 2 3 4; do
  "$@" 2>&1 | tee "$log"
  status="${PIPESTATUS[0]}"
  [ "$status" -eq 0 ] && exit 0
  if [ "$attempt" -lt 4 ] && grep -qiE 'toomanyrequests|rate exceeded|data limit exceeded|TLS handshake timeout|unexpected EOF|connection reset by peer|address already in use' "$log"; then
    wait=$((15 * 2 ** attempt))
    echo "::warning::a registry refused or dropped a pull, or a port was taken (attempt $attempt of 4); trying again in ${wait}s: $*"
    # A failed supabase start can leave containers behind.
    docker ps -aq --filter 'name=supabase_' | xargs -r docker rm -f > /dev/null 2>&1
    sleep "$wait"
    continue
  fi
  exit "$status"
done
