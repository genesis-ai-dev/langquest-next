#!/usr/bin/env bash
# Turn on the scheduled v2 → Next sync (docs/v2-import.md, "Going live").
# Gives the GitHub workflow the keys it needs, from where the team keeps them,
# then switches it on. Prints no secret.
#
#   scripts/v2-go-live.sh          after the v2 import's PR is merged
#
# Needs: gh (logged in), the Supabase CLI (logged in), and .env.keys, with
# V2_SUPABASE_ANON_KEY (npm run env:update -- production V2_SUPABASE_ANON_KEY)
# and, for names, V2_DATABASE_URL (scripts/v2-access.sh) in .env.production.
set -euo pipefail
cd "$(dirname "$0")/.."

repo=genesis-ai-dev/langquest-next
ref=xymxnebdwtbkfxlbylch   # Next's production project
get() { DOTENVX_NO_NATIVE=true npx dotenvx get "$1" -f .env.production -fk .env.keys 2>/dev/null || true; }

gh auth status > /dev/null 2>&1 || { echo "x gh is not logged in: gh auth login" >&2; exit 1; }

key=$(get V2_SUPABASE_ANON_KEY)
[ -n "$key" ] || { echo "x .env.production has no V2_SUPABASE_ANON_KEY: npm run env:update -- production V2_SUPABASE_ANON_KEY" >&2; exit 1; }
printf '%s' "$key" | gh secret set V2_SUPABASE_ANON_KEY -R "$repo"
unset key
echo "✓ V2_SUPABASE_ANON_KEY"

npx supabase projects api-keys --project-ref "$ref" -o json \
  | node -e 'let t="";process.stdin.on("data",(c)=>t+=c).on("end",()=>{const k=JSON.parse(t.slice(t.indexOf("["))).find((x)=>x.name==="service_role");if(!k)process.exit(1);process.stdout.write(k.api_key)})' \
  | gh secret set V3_SERVICE_ROLE_KEY -R "$repo"
echo "✓ V3_SERVICE_ROLE_KEY"

db=$(get V2_DATABASE_URL)
if [ -n "$db" ]; then
  printf '%s' "$db" | gh secret set V2_DATABASE_URL -R "$repo"
  echo "✓ V2_DATABASE_URL (people's names)"
else
  echo "- no V2_DATABASE_URL: people show by id until they sign in (scripts/v2-access.sh adds names)"
fi
unset db

echo "Signing in with a v2 account needs v2's key in the Edge Function too: running npm run secrets -- production"
npm run secrets -- production

read -r -p "Start the scheduled sync now (every 15 minutes, and nightly)? [y/N] " answer
if [ "$answer" = y ] || [ "$answer" = Y ]; then
  gh variable set V2_IMPORT_ENABLED --body true -R "$repo"
  echo "✓ On. It runs at the next quarter hour; npm run v2 -- board --production shows it."
else
  echo "Not switched on. When ready: gh variable set V2_IMPORT_ENABLED --body true -R $repo"
fi
