#!/usr/bin/env bash
# The dashboard Worker's production settings, encrypted in
# apps/web/.env.production with the same production key as
# apps/mobile/.env.production. Cloudflare holds only that private key.
#
#   npm run web:secrets -- fetch   encrypt the linked project's URL and
#                                  service-role key into the env file and
#                                  commit that file alone
#   npm run web:secrets            build and deploy the dashboard with
#                                  that file (shows the names and asks first)
#
# Prints no secret. The service-role key never goes in apps/mobile/.env.*,
# which EAS and the app bundle receive.
set -euo pipefail
cd "$(dirname "$0")/.."

file=apps/web/.env.production
mobile=apps/mobile/.env.production
public=$(grep '^DOTENV_PUBLIC_KEY_PRODUCTION=' "$mobile")

ensure_key() {
  if [ ! -f "$file" ]; then
    printf '%s\n' "$public" > "$file"
  elif ! grep -q "^DOTENV_PUBLIC_KEY_PRODUCTION=" "$file"; then
    printf '%s\n%s\n' "$public" "$(cat "$file")" > "$file"
  fi
  grep -qx "$public" "$file" || {
    echo "x $file uses a different production key than $mobile, so one Cloudflare secret cannot decrypt both." >&2
    exit 1
  }
}

if [ "${1:-}" = fetch ]; then
  [ -f supabase/.temp/project-ref ] || { echo "x not linked. Run: npx supabase link --project-ref <ref>" >&2; exit 1; }
  if [ -n "$(git status --porcelain -- "$file")" ]; then
    echo "x $file has uncommitted changes; commit or discard them first." >&2; exit 1
  fi
  ref=$(cat supabase/.temp/project-ref)
  ensure_key
  key=$(npx supabase projects api-keys --project-ref "$ref" -o json |
    node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const k=JSON.parse(s).find((k)=>k.name==="service_role");process.stdout.write(k?k.api_key:"")})')
  [ -n "$key" ] || { echo "x the project reported no service_role key" >&2; exit 1; }
  DOTENVX_NO_NATIVE=true npx dotenvx set SUPABASE_URL "https://$ref.supabase.co" -f "$file" -fk .env.keys > /dev/null
  DOTENVX_NO_NATIVE=true npx dotenvx set SUPABASE_SERVICE_ROLE_KEY "$key" -f "$file" -fk .env.keys > /dev/null
  unset key
  node scripts/env-check.mjs > /dev/null
  if [ -z "$(git status --porcelain -- "$file")" ]; then
    echo "✓ $file already had the linked project's URL and service-role key"
  else
    git add -- "$file"
    git commit -q -m "env(web production): set the dashboard Worker configuration" -- "$file"
    echo "✓ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY encrypted in $file and committed."
    echo "  Deploy with: npm run web:secrets"
  fi
  exit 0
fi

[ -f "$file" ] || { echo "x $file does not exist yet. Run: npm run web:secrets -- fetch" >&2; exit 1; }
names=$(grep -E '^[A-Z][A-Z0-9_]*=' "$file" | grep -v '^DOTENV_' | cut -d= -f1 | tr '\n' ' ')
echo "Deploys langquest-dashboard with: $names"
read -r -p "Build and deploy the dashboard with these settings? [y/N] " ok
[ "$ok" = y ] || { echo "Nothing deployed."; exit 0; }
npm run web:deploy
