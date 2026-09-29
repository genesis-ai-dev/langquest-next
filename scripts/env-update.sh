#!/usr/bin/env bash
# Change one setting the infrastructure-as-code way: encrypt it into the
# env file, commit that file alone, then (for hosted environments) copy it
# to EAS.
#
#   npm run env:update -- preview EXPO_PUBLIC_FOO           asks for the value, hidden
#   npm run env:update -- preview EXPO_PUBLIC_FOO 'value'   value on the command line
#   npm run env:update -- development EXPO_PUBLIC_FOO       local only, no EAS step
#
# Leaving the value out keeps secrets out of shell history.
set -euo pipefail
cd "$(dirname "$0")/.."

env="${1:-}"; key="${2:-}"
case "$env" in development|preview|production) ;; *)
  echo "usage: npm run env:update -- <development|preview|production> KEY ['value']" >&2; exit 2 ;;
esac
[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "x KEY must be UPPER_SNAKE_CASE, got '$key'" >&2; exit 2; }
[[ "$key" == DOTENV_* ]] && { echo "x $key is managed by dotenvx itself" >&2; exit 2; }

src="apps/mobile/.env.$env"
if [ -n "$(git status --porcelain -- "$src")" ]; then
  echo "x $src already has uncommitted changes; commit or discard them first so this change commits on its own." >&2
  exit 1
fi

if [ $# -ge 3 ]; then
  value="$3"
else
  read -r -s -p "Value for $key in $env (hidden): " value; echo
fi
[ -n "$value" ] || { echo "x empty value. To remove a key: npx dotenvx del $key -f $src" >&2; exit 1; }

DOTENVX_NO_NATIVE=true npx dotenvx set "$key" "$value" -f "$src" -fk .env.keys > /dev/null
unset value
node scripts/env-check.mjs > /dev/null

if [ -z "$(git status --porcelain -- "$src")" ]; then
  echo "✓ $key already had that value in $env; nothing to commit"
else
  git add -- "$src"
  git commit -q -m "env($env): set $key" -- "$src"
  echo "✓ $key set in $src and committed ($(git rev-parse --short HEAD)). Push the branch when ready."
fi

if [ "$env" = development ]; then
  echo "  development is local only; teammates get it when they pull."
else
  exec scripts/eas-env.sh push "$env"
fi
