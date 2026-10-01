#!/usr/bin/env bash
# Change one setting the infrastructure-as-code way: encrypt it into the
# env file, commit that file alone, then (for the app's hosted environments)
# copy it to EAS. docs/environments.md has the whole picture.
#
#   npm run env:update -- preview EXPO_PUBLIC_FOO              the app (apps/mobile), asks for the value, hidden
#   npm run env:update -- preview web SUPABASE_URL             another target: mobile, web, invite-email, supabase
#   npm run env:update -- preview EXPO_PUBLIC_FOO 'value'      value on the command line
#   npm run env:update -- development EXPO_PUBLIC_FOO          local only, no EAS step
#
# Leaving the value out keeps secrets out of shell history. A target's file
# is created with its environment's public key (the one apps/mobile uses),
# so one private key per environment opens every file.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() { echo "usage: npm run env:update -- <development|preview|production> [mobile|web|invite-email|supabase] KEY ['value']" >&2; exit 2; }

env="${1:-}"
case "$env" in development|preview|production) ;; *) usage ;; esac
shift
target=mobile
case "${1:-}" in mobile|web|invite-email|supabase) target="$1"; shift ;; esac
key="${1:-}"
[[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "x KEY must be UPPER_SNAKE_CASE, got '$key'" >&2; usage; }
[[ "$key" == DOTENV_* ]] && { echo "x $key is managed by dotenvx itself" >&2; exit 2; }

case "$target" in
  mobile) dir=apps/mobile ;; web) dir=apps/web ;; invite-email) dir=apps/invite-email ;; supabase) dir=supabase ;;
esac
if [ "$env" = development ] && [ "$target" != mobile ]; then
  echo "x development has no $target file: locally it reads the local Supabase (docs/environments.md)" >&2; exit 2
fi
src="$dir/.env.$env"
mobile="apps/mobile/.env.$env"
name="DOTENV_PUBLIC_KEY_$(echo "$env" | tr a-z A-Z)"
public=$(grep "^$name=" "$mobile")
pubkey=$(sed -E 's/^[^"]*"([0-9a-f]+)".*/\1/' <<< "$public")

if [ -n "$(git status --porcelain -- "$src")" ]; then
  echo "x $src already has uncommitted changes; commit or discard them first so this change commits on its own." >&2
  exit 1
fi
if [ ! -f "$src" ]; then
  printf '%s\n' "$public" > "$src"
elif ! grep -q "^$name=\"$pubkey\"" "$src"; then
  echo "x $src is not encrypted with the $env key $mobile uses; re-key it first (docs/environments.md)." >&2
  exit 1
fi

if [ $# -ge 2 ]; then
  value="$2"
else
  read -r -s -p "Value for $key in $src (hidden): " value; echo
fi
[ -n "$value" ] || { echo "x empty value. To remove a key: npx dotenvx del $key -f $src" >&2; exit 1; }

DOTENVX_NO_NATIVE=true npx dotenvx set "$key" "$value" -f "$src" -fk .env.keys > /dev/null
unset value
node scripts/env-check.mjs > /dev/null

if [ -z "$(git status --porcelain -- "$src")" ]; then
  echo "✓ $key already had that value in $src; nothing to commit"
else
  git add -- "$src"
  git commit -q -m "env($env $target): set $key" -- "$src"
  echo "✓ $key set in $src and committed ($(git rev-parse --short HEAD)). Push the branch when ready."
fi

case "$target" in
  mobile)
    if [ "$env" = development ]; then
      echo "  development is local only; teammates get it when they pull."
    else
      exec scripts/eas-env.sh push "$env"
    fi ;;
  supabase) echo "  Apply it to the hosted project: npm run supabase:secrets -- $env" ;;
  *)
    branch=main; suffix=""
    [ "$env" = preview ] && { branch=develop; suffix=":preview"; }
    script=web; [ "$target" = invite-email ] && script=email
    echo "  The $target Worker picks it up on its next deploy (merge to $branch, or npm run $script:deploy$suffix)." ;;
esac
