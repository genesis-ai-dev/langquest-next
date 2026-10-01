#!/usr/bin/env bash
# Fill an environment's Supabase URL and keys from the hosted project, and
# deploy the dashboard by hand. Each file uses its environment's key, the
# same public key as apps/mobile/.env.<environment> (docs/environments.md).
#
#   npm run web:secrets -- fetch preview      read SUPABASE_PROJECT_REF from
#                                             supabase/.env.preview, then encrypt
#                                             the project's URL and keys into
#                                             apps/web/.env.preview (service role)
#                                             and apps/mobile/.env.preview (anon),
#                                             and commit those two files alone
#   npm run web:secrets -- fetch production   the same for production
#   npm run web:secrets [preview]             build and deploy the dashboard with
#                                             that file (shows the names, asks first)
#
# Prints no secret. The service-role key never goes in apps/mobile/.env.*,
# which EAS and the app bundle receive.
set -euo pipefail
cd "$(dirname "$0")/.."

set_value() { DOTENVX_NO_NATIVE=true npx dotenvx set "$2" "$3" -f "$1" -fk .env.keys > /dev/null; }

if [ "${1:-}" = fetch ]; then
  env="${2:-production}"
  case "$env" in preview|production) ;; *) echo "usage: npm run web:secrets -- fetch <preview|production>" >&2; exit 2 ;; esac
  web=apps/web/.env.$env
  mobile=apps/mobile/.env.$env
  supa=supabase/.env.$env
  name="DOTENV_PUBLIC_KEY_$(echo "$env" | tr a-z A-Z)"
  public=$(grep "^$name=" "$mobile")
  pubkey=$(sed -E 's/^[^"]*"([0-9a-f]+)".*/\1/' <<< "$public")
  for f in "$web" "$mobile"; do
    if [ -n "$(git status --porcelain -- "$f")" ]; then
      echo "x $f has uncommitted changes; commit or discard them first." >&2; exit 1
    fi
  done
  if [ ! -f "$web" ]; then printf '%s\n' "$public" > "$web"; fi
  for f in "$web" "$supa"; do
    grep -q "^$name=\"$pubkey\"" "$f" 2> /dev/null || {
      echo "x $f is missing or not encrypted with the $env key $mobile uses (docs/environments.md, re-keying)." >&2; exit 1
    }
  done
  ref=$(npx dotenvx get SUPABASE_PROJECT_REF -f "$supa" -fk .env.keys 2> /dev/null || true)
  [[ "$ref" =~ ^[a-z0-9]{20}$ ]] || {
    echo "x no SUPABASE_PROJECT_REF in $supa. Set it: npm run env:update -- $env supabase SUPABASE_PROJECT_REF" >&2; exit 1
  }
  keys=$(npx supabase projects api-keys --project-ref "$ref" -o json)
  pick() { node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const k=JSON.parse(s).find((k)=>k.name===process.argv[1]);process.stdout.write(k?k.api_key:"")})' "$1" <<< "$keys"; }
  service=$(pick service_role); anon=$(pick anon); unset keys
  [ -n "$service" ] && [ -n "$anon" ] || { echo "x project $ref reported no service_role or anon key" >&2; exit 1; }
  set_value "$web" SUPABASE_URL "https://$ref.supabase.co"
  set_value "$web" SUPABASE_SERVICE_ROLE_KEY "$service"
  set_value "$mobile" EXPO_PUBLIC_SUPABASE_URL "https://$ref.supabase.co"
  set_value "$mobile" EXPO_PUBLIC_SUPABASE_ANON_KEY "$anon"
  unset service anon
  node scripts/env-check.mjs > /dev/null
  if [ -z "$(git status --porcelain -- "$web" "$mobile")" ]; then
    echo "✓ $web and $mobile already had project $ref's URL and keys"
  else
    git add -- "$web" "$mobile"
    git commit -q -m "env($env): point the dashboard and app at project $ref" -- "$web" "$mobile"
    echo "✓ project $ref's URL and keys encrypted in $web and $mobile, and committed."
    echo "  Copy the app's settings to EAS: npm run env:push:eas -- $env"
  fi
  exit 0
fi

env="${1:-production}"
case "$env" in preview|production) ;; *) echo "usage: npm run web:secrets [-- preview]" >&2; exit 2 ;; esac
file=apps/web/.env.$env
[ -f "$file" ] || { echo "x $file does not exist yet. Run: npm run web:secrets -- fetch $env" >&2; exit 1; }
names=$(grep -E '^[A-Z][A-Z0-9_]*=' "$file" | grep -v '^DOTENV_' | cut -d= -f1 | tr '\n' ' ')
worker=langquest-dashboard; script=web:deploy
[ "$env" = preview ] && { worker=langquest-dashboard-preview; script=web:deploy:preview; }
echo "Deploys $worker with: $names"
read -r -p "Build and deploy the dashboard with these settings? [y/N] " ok
[ "$ok" = y ] || { echo "Nothing deployed."; exit 0; }
npm run "$script"
