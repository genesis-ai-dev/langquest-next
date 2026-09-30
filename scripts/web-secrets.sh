#!/usr/bin/env bash
# The dashboard Worker's secrets, the infrastructure-as-code way: encrypted
# in apps/web/.env.production, pushed with wrangler secret bulk.
#
#   npm run web:secrets -- fetch   encrypt the linked project's service-role
#                                  key into apps/web/.env.production and
#                                  commit that file alone
#   npm run web:secrets            push the file's secrets to the Worker
#                                  (shows the names and asks first)
#
# Prints no secret. The service-role key never goes in apps/mobile/.env.*,
# which EAS and the app bundle receive.
set -euo pipefail
cd "$(dirname "$0")/.."

file=apps/web/.env.production
config=apps/web/wrangler.jsonc

if [ "${1:-}" = fetch ]; then
  [ -f supabase/.temp/project-ref ] || { echo "x not linked. Run: npx supabase link --project-ref <ref>" >&2; exit 1; }
  if [ -n "$(git status --porcelain -- "$file")" ]; then
    echo "x $file has uncommitted changes; commit or discard them first." >&2; exit 1
  fi
  ref=$(cat supabase/.temp/project-ref)
  grep -q "https://$ref.supabase.co" "$config" || {
    echo "x $config does not point SUPABASE_URL at the linked project ($ref); fix one of them first." >&2; exit 1
  }
  key=$(npx supabase projects api-keys --project-ref "$ref" -o json |
    node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const k=JSON.parse(s).find((k)=>k.name==="service_role");process.stdout.write(k?k.api_key:"")})')
  [ -n "$key" ] || { echo "x the project reported no service_role key" >&2; exit 1; }
  DOTENVX_NO_NATIVE=true npx dotenvx set SUPABASE_SERVICE_ROLE_KEY "$key" -f "$file" -fk .env.keys > /dev/null
  unset key
  node scripts/env-check.mjs > /dev/null
  if [ -z "$(git status --porcelain -- "$file")" ]; then
    echo "✓ $file already had that key; nothing to commit"
  else
    git add -- "$file"
    git commit -q -m "env(web production): set SUPABASE_SERVICE_ROLE_KEY" -- "$file"
    echo "✓ SUPABASE_SERVICE_ROLE_KEY encrypted in $file and committed. Push it with: npm run web:secrets"
  fi
  exit 0
fi

[ -f "$file" ] || { echo "x $file does not exist yet. Run: npm run web:secrets -- fetch" >&2; exit 1; }
names=$(grep -E '^[A-Z][A-Z0-9_]*=' "$file" | grep -v '^DOTENV_' | cut -d= -f1 | tr '\n' ' ')
echo "Sets on the langquest-dashboard Worker: $names"
read -r -p "Push these secrets to Cloudflare? [y/N] " ok
[ "$ok" = y ] || { echo "Nothing pushed."; exit 0; }
# shellcheck disable=SC2016
npx dotenvx run -f "$file" -fk .env.keys --strict --quiet -- \
  node -e 'const o={};for(const n of process.argv.slice(1))o[n]=process.env[n];process.stdout.write(JSON.stringify(o))' $names |
  npx wrangler secret bulk -c "$config" --profile langquest-email
