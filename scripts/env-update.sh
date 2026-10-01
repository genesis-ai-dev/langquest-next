#!/usr/bin/env bash
# Change one setting the infrastructure-as-code way (docs/environments.md):
# write it to its file, commit that file alone, then say or do what applies it.
#
#   npm run env:update -- preview EXPO_PUBLIC_FOO 'value'           public: plain in apps/mobile/.env.preview, then EAS
#   npm run env:update -- preview INVITE_RELAY_SECRET               secret: asks (hidden), encrypts into .env.preview
#   npm run env:update -- production PROJECTION_WORKER_SECRET "$(openssl rand -hex 32)"
#
# The key's name picks the file: EXPO_PUBLIC_* is public and goes in the
# app's file; anything else is a secret and goes in the root .env.<env>,
# which `npm run secrets -- <env>` applies. Development has no secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

env="${1:-}"; key="${2:-}"
case "$env" in development|preview|production) ;; *)
  echo "usage: npm run env:update -- <development|preview|production> KEY ['value']" >&2; exit 2 ;;
esac
[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "x KEY must be UPPER_SNAKE_CASE, got '$key'" >&2; exit 2; }
[[ "$key" == DOTENV_* ]] && { echo "x $key is managed by dotenvx itself" >&2; exit 2; }

if [[ "$key" == EXPO_PUBLIC_* ]]; then
  src="apps/mobile/.env.$env"; kind=public
else
  [ "$env" = development ] && { echo "x development has no secrets; $key is not EXPO_PUBLIC_*" >&2; exit 2; }
  src=".env.$env"; kind=secret
fi
if [ -n "$(git status --porcelain -- "$src")" ]; then
  echo "x $src already has uncommitted changes; commit or discard them first so this change commits on its own." >&2
  exit 1
fi

if [ $# -ge 3 ]; then
  value="$3"
else
  read -r -s -p "Value for $key in $src (hidden): " value; echo
fi
[ -n "$value" ] || { echo "x empty value. To remove a key: npx dotenvx del $key -f $src" >&2; exit 1; }

if [ "$kind" = public ]; then
  npx dotenvx set "$key" "$value" -f "$src" --plain > /dev/null
else
  DOTENVX_NO_NATIVE=true npx dotenvx set "$key" "$value" -f "$src" -fk .env.keys > /dev/null
fi
unset value
node scripts/env-check.mjs > /dev/null

if [ -z "$(git status --porcelain -- "$src")" ]; then
  echo "✓ $key already had that value in $src; nothing to commit"
else
  git add -- "$src"
  git commit -q -m "env($env): set $key" -- "$src"
  echo "✓ $key set in $src and committed ($(git rev-parse --short HEAD)). Push the branch when ready."
fi

if [ "$kind" = secret ]; then
  echo "  Apply it: npm run secrets -- $env"
elif [ "$env" = development ]; then
  echo "  development is local only; teammates get it when they pull."
else
  exec scripts/eas-env.sh push "$env"
fi
