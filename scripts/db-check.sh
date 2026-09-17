#!/usr/bin/env bash
# Schema drift check for the hosted Supabase project.
#
#   npm run db:check          migrations: uncommitted, unapplied, or applied-but-missing
#   npm run db:check -- --diff  also diff the live schema against the migrations (needs Docker)
#
# Exit 1 on anything that needs a human: an uncommitted migration file, a
# remote migration this branch does not have, or a live schema that differs
# from what the migrations say. Unapplied local migrations are reported but
# do not fail: `npm run db:apply` is the fix.
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
bad()  { printf '\033[31mx %s\033[0m\n' "$*"; fail=1; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }

if [ ! -f supabase/.temp/project-ref ]; then
  bad "not linked to a hosted project. Run: npx supabase link --project-ref <ref>"
  exit 1
fi
ref=$(cat supabase/.temp/project-ref)

# 1. Migration files not yet committed on this branch.
dirty=$(git status --porcelain -- supabase/migrations | sed 's/^...//')
if [ -n "$dirty" ]; then
  bad "uncommitted migration files:"
  printf '    %s\n' $dirty
else
  ok "every migration file is committed"
fi

# 2. Local migrations versus what the hosted project has applied.
#    `migration list` prints one row per version: LOCAL | REMOTE | TIME.
list=$(npx supabase migration list --linked 2>/dev/null | sed -n '/^ *[0-9]/p' || true)
if [ -z "$list" ]; then
  bad "could not read remote migrations for $ref (not logged in? run: npx supabase login)"
else
  unapplied=$(echo "$list" | awk -F'|' '$1 ~ /[0-9]/ && $2 !~ /[0-9]/ {gsub(/ /,"",$1); print $1}')
  missing=$(echo "$list"   | awk -F'|' '$1 !~ /[0-9]/ && $2 ~ /[0-9]/ {gsub(/ /,"",$2); print $2}')
  if [ -n "$missing" ]; then
    bad "applied on $ref but not in this branch (drift, or you are behind main):"
    printf '    %s\n' $missing
  fi
  if [ -n "$unapplied" ]; then
    warn "in this branch, not yet applied to $ref (run: npm run db:apply):"
    printf '    %s\n' $unapplied
  fi
  if [ -z "$missing" ] && [ -z "$unapplied" ]; then ok "migrations match $ref"; fi
fi

# 3. Optional: the live schema against the migrations (shadow database, needs Docker).
if [ "${1:-}" = "--diff" ]; then
  diff=$(npx supabase db diff --linked 2>/dev/null || true)
  if [ -n "$diff" ]; then
    bad "live schema on $ref differs from the migrations:"
    echo "$diff"
  else
    ok "live schema matches the migrations"
  fi
fi

exit $fail
