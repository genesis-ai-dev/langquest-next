#!/usr/bin/env bash
# Check this machine's env setup, for a new teammate or when something will
# not decrypt. Prints no values. Running the app needs no key at all; keys
# only open the hosted environments' secrets (docs/environments.md).
#
#   npm run env:doctor
set -uo pipefail
cd "$(dirname "$0")/.."

ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
bad()  { printf '\033[31mx %s\033[0m\n' "$*"; fail=1; }
fail=0

if npx --no-install dotenvx --version > /dev/null 2>&1; then ok "dotenvx installed"; else bad "dotenvx missing: run npm install"; fi

for env in development preview production; do
  src="apps/mobile/.env.$env"
  [ -f "$src" ] || { warn "$src does not exist"; continue; }
  if grep -q 'encrypted:' "$src"; then
    warn "$src still has encrypted values; public settings are plain (docs/environments.md, making the app's files plain)"
  else
    ok "$src is plain"
  fi
done

if [ -f .env.keys ]; then
  ok ".env.keys found at the repository root"
  perms=$(stat -f '%Lp' .env.keys 2>/dev/null || stat -c '%a' .env.keys)
  [ "$perms" = 600 ] && ok ".env.keys is private to you" || warn ".env.keys is readable by others ($perms); fix: chmod 600 .env.keys"
  git check-ignore -q .env.keys && ok "git ignores .env.keys" || bad "git does NOT ignore .env.keys; do not commit, check .gitignore"
else
  warn "no .env.keys at the repository root: fine for running the app; get the preview key to change hosted secrets"
fi

for env in preview production; do
  src=".env.$env"
  if ! grep -q 'encrypted:' "$src"; then
    warn "$src holds no secrets yet"
  elif out=$(npx dotenvx decrypt --stdout -f "$src" -fk .env.keys 2> /dev/null) && ! grep -q 'encrypted:' <<< "$out"; then
    ok "can read $src"
  else
    warn "cannot read $src: fine unless you change $env secrets (DOTENV_PRIVATE_KEY_$(echo "$env" | tr a-z A-Z))"
  fi
done

node scripts/env-check.mjs > /dev/null 2>&1 && ok "every committed secret is encrypted and in its place" || bad "a secret is plain or misplaced: run npm run env:check"

[ "$fail" = 0 ] && ok "env setup looks good" || exit 1
