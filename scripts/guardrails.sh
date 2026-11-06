#!/bin/bash
# The guardrails CI workflow (.github/workflows/guardrails.yml), run here
# before a push, so a red check is found in minutes instead of after one.
#
#   npm run guardrails            the `checks` job: typecheck, the unit suite
#                                 with coverage, the worker bundle parity
#   npm run guardrails -- --web   also the release web export and its size
#                                 budget (what web-smoke and ui-web build first)
#   npm run guardrails -- --all   also the server job and the P0 web UI tests
#                                 against the local stack (needs Docker; starts
#                                 it with npm run db:start if it is down)
#
# CI tests the pull request merged with main, not the branch alone, so this
# first says when origin/main has commits the branch does not.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

level=checks
case "${1:-}" in
  '') ;;
  --web) level=web ;;
  --all) level=all ;;
  *) echo "usage: npm run guardrails [-- --web | --all]" >&2; exit 2 ;;
esac

step() { printf '\n== %s\n' "$1"; }

step "Is the branch up to date with main?"
if git fetch -q origin main 2>/dev/null; then
  behind=$(git rev-list --count HEAD..origin/main)
  if [ "$behind" -gt 0 ]; then
    echo "! origin/main has $behind commit(s) this branch does not. CI runs on the merge, so merge main"
    echo "  first (git merge origin/main) or a check can fail there that passes here."
    echo "  Recent changes to the guardrails themselves:"
    git log --format='    %h %s' HEAD..origin/main -- .github/workflows .githooks vitest.config.ts e2e/ui.config.ts e2e/web-smoke.config.ts apps/mobile/scripts/export-web.mjs | head -10
  else
    echo "yes"
  fi
else
  echo "! could not fetch origin/main; skipped"
fi
# A shallow clone (a cloud thread's) lacks the commits that store builds were
# made from, which the server-call check reads; CI fetches them all too.
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  git fetch -q --unshallow origin || echo "! could not fetch the full history; the server-call check needs it"
fi

step "Typecheck"
npm run --silent typecheck

step "Lint: what may import what (eslint.config.mjs)"
npm run --silent lint

step "Server calls that store builds make (decisions.md 151)"
npm run --silent server-calls

step "Unit, property and model tests, with coverage thresholds"
npm run --silent test:coverage

step "Push delivery bundle matches its source"
npm run --silent build:push-delivery
if ! git diff --quiet -- supabase/functions; then
  echo "x the bundle was behind its source; it is rebuilt now. Commit supabase/functions."
  exit 1
fi
echo "yes"

[ "$level" = checks ] && { printf '\nchecks: passed\n'; exit 0; }

step "Release web export and its size budget"
npm run --silent export:web -w mobile -- development

[ "$level" = web ] && { printf '\nchecks and web export: passed (web-smoke and ui-web still run only with --all or in CI)\n'; exit 0; }

step "Local stack"
# Started as CI starts it: without the services the tests do not use, and
# without the language list (db:start leaves it out on CI), which the UI tests
# expect to be empty (SETUP-074 adds a language the list would offer instead).
export SUPABASE_EXCLUDE="${SUPABASE_EXCLUDE-studio,imgproxy,vector,logflare,supavisor}"
# db:start also restarts a stack whose Edge Functions are down (scripts/local-db.mjs).
if ! source e2e/env.sh 2>/dev/null || ! docker ps --format '{{.Names}}' | grep -q '^supabase_edge_runtime_'; then
  CI=true npm run db:start
fi

step "SQL smokes, parity and the client integration test (server)"
npm run --silent db:test
npm run --silent test:integration
npm run --silent test:old-sync

# db:test reset the database with a bare `supabase db reset`, which drops the
# library and push delivery's Vault values and cron job. The ui-web
# job starts from `npm run db:start`, so put back what it leaves (on a running
# stack that is only scripts/local-db.mjs prepare()).
step "Library and push delivery back after the reset (npm run db:start)"
CI=true npm run --silent db:start

step "P0 web UI tests on the export (ui-web)"
# Two browsers at a time on 4 cores or fewer (a cloud thread's machine), as
# on each CI shard (guardrails.yml, ui-web): with four, pages there loaded
# past the tests' waits.
if [ "$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 8)" -le 4 ]; then export UI_WORKERS="${UI_WORKERS:-2}"; fi
npm run test:ui:web -- --grep @p0 --grep-invert @quarantine

printf '\nall guardrails: passed (web-smoke in Firefox and WebKit runs only in CI, or npm run test:web-smoke)\n'
