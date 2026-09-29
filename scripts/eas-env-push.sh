#!/usr/bin/env bash
# Push apps/mobile/.env.<environment> (dotenvx-encrypted, in git) to the EAS
# environment of the same name, which is what EAS Build and `eas update
# --environment` read. The file is the source of truth; the EAS dashboard is
# its copy.
#
#   npm run env:push:eas -- preview
#
# Needs DOTENV_PRIVATE_KEY_<ENVIRONMENT> in .env.keys (or the environment).
# The decrypted values exist only in a private temp file removed on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

env="${1:-}"
case "$env" in
  development|preview|production) ;;
  *) echo "usage: npm run env:push:eas -- <development|preview|production>" >&2; exit 2 ;;
esac

src="apps/mobile/.env.$env"
[ -f "$src" ] || { echo "no $src; create it with npm run env:set -- KEY value -f $src" >&2; exit 1; }

umask 077
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
npx dotenvx decrypt --stdout -f "$src" -fk .env.keys | grep -v '^DOTENV_PUBLIC_KEY' > "$tmp"
if grep -q 'encrypted:' "$tmp"; then
  echo "could not decrypt $src: DOTENV_PRIVATE_KEY_$(echo "$env" | tr a-z A-Z) is missing from .env.keys" >&2
  exit 1
fi

cd apps/mobile
npx eas env:push "$env" --path "$tmp"
