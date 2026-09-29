#!/usr/bin/env bash
# Keep an EAS environment in step with apps/mobile/.env.<environment>, the
# encrypted file in git that EAS copies. EAS Build and `npm run ship` read EAS.
#
#   npm run env:diff:eas -- preview          what differs (names only)
#   npm run env:push:eas -- preview          push the committed file to EAS
#   npm run env:push:eas -- preview --yes    same, without the question
#
# Needs DOTENV_PRIVATE_KEY_<ENVIRONMENT> in .env.keys. Decrypted values exist
# only in a private temp folder that is removed on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-}"; env="${2:-}"; yes="${3:-}"
case "$cmd" in diff|push) ;; *) echo "usage: scripts/eas-env.sh <diff|push> <environment> [--yes]" >&2; exit 2 ;; esac
case "$env" in
  preview|production) ;;
  development) echo "development is local only (npm start reads the file directly); nothing to sync" >&2; exit 2 ;;
  *) echo "usage: npm run env:$cmd:eas -- <preview|production>" >&2; exit 2 ;;
esac

src="apps/mobile/.env.$env"
[ -f "$src" ] || { echo "no $src; create it with npm run env:update -- $env KEY" >&2; exit 1; }

if [ "$cmd" = push ]; then
  if [ -n "$(git status --porcelain -- "$src")" ]; then
    echo "x $src has uncommitted changes. Commit it first: the committed file is what EAS should hold." >&2
    exit 1
  fi
fi

umask 077
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

npx dotenvx decrypt --stdout -f "$src" -fk .env.keys > "$dir/repo.env"
if grep -q 'encrypted:' "$dir/repo.env"; then
  echo "x cannot decrypt $src: DOTENV_PRIVATE_KEY_$(echo "$env" | tr a-z A-Z) is missing from .env.keys" >&2
  exit 1
fi
grep -v '^DOTENV_PUBLIC_KEY' "$dir/repo.env" > "$dir/push.env"

(cd apps/mobile && npx eas env:pull "$env" --path "$dir/eas.env" --non-interactive > /dev/null)

echo "Comparing $src with EAS \"$env\":"
if node scripts/env-diff.mjs "$dir/repo.env" "$dir/eas.env"; then
  echo "✓ EAS $env matches the repo"
  exit 0
fi
[ "$cmd" = diff ] && exit 1

if [ "$yes" != "--yes" ]; then
  read -r -p "Push the repo values to EAS $env? [y/N] " answer
  [[ "$answer" =~ ^[yY]$ ]] || { echo "Not pushed."; exit 1; }
fi
(cd apps/mobile && npx eas env:push "$env" --path "$dir/push.env" --force)
echo "✓ pushed $src to EAS $env. Keys only in EAS (marked !) were left alone."
