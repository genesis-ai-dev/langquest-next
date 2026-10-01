#!/usr/bin/env bash
# Give `diag_reader` a login on the hosted project and keep its connection
# string encrypted in .env.production (docs/diagnostics.md).
#
#   npm run diag:access              once, after the field diagnostics
#                                    migration is on the hosted database
#   npm run diag:hosted -- report …  then read hosted diagnostics
#
# Running it again rotates the password. It prints no secret, and commits
# .env.production alone. A support credential never goes in
# apps/mobile/.env.*, which EAS receives.
set -euo pipefail
cd "$(dirname "$0")/.."

file=.env.production
[ -f supabase/.temp/project-ref ] || { echo "x not linked. Run: npx supabase link --project-ref <ref>" >&2; exit 1; }
[ -f supabase/.temp/pooler-url ] || { echo "x no pooler URL in supabase/.temp; run npx supabase link again" >&2; exit 1; }
if [ -n "$(git status --porcelain -- "$file")" ]; then
  echo "x $file has uncommitted changes; commit or discard them first." >&2; exit 1
fi

ref=$(cat supabase/.temp/project-ref)
host=$(sed -E 's#.*@([^:/]+).*#\1#' supabase/.temp/pooler-url)
pw=$(openssl rand -hex 24)   # hex, so the URL needs no escaping

sql=$(mktemp); trap 'rm -f "$sql"' EXIT
printf "alter role diag_reader with login password '%s';\n" "$pw" > "$sql"
npx supabase db query --linked -f "$sql" > /dev/null
echo "✓ diag_reader can log in on $ref"

DOTENVX_NO_NATIVE=true npx dotenvx set DIAG_DATABASE_URL \
  "postgresql://diag_reader.$ref:$pw@$host:5432/postgres" -f "$file" -fk .env.keys > /dev/null
git add "$file"
git commit -q -m "Hosted diagnostics access for diag_reader" -- "$file"
echo "✓ DIAG_DATABASE_URL encrypted in $file and committed"
