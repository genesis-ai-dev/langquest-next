#!/usr/bin/env bash
# Check this machine's env setup, for a new teammate or when something will
# not decrypt. Prints no values.
#
#   npm run env:doctor
set -uo pipefail
cd "$(dirname "$0")/.."

ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
bad()  { printf '\033[31mx %s\033[0m\n' "$*"; fail=1; }
fail=0

if npx --no-install dotenvx --version > /dev/null 2>&1; then ok "dotenvx installed"; else bad "dotenvx missing: run npm install"; fi

if [ -f .env.keys ]; then
  ok ".env.keys found at the repository root"
  perms=$(stat -f '%Lp' .env.keys 2>/dev/null || stat -c '%a' .env.keys)
  [ "$perms" = 600 ] && ok ".env.keys is private to you" || warn ".env.keys is readable by others ($perms); fix: chmod 600 .env.keys"
  git check-ignore -q .env.keys && ok "git ignores .env.keys" || bad "git does NOT ignore .env.keys; do not commit, check .gitignore"
else
  bad "no .env.keys at the repository root. Get it from a teammate through the password manager."
fi

for env in development preview production; do
  src="apps/mobile/.env.$env"
  [ -f "$src" ] || { warn "$src does not exist"; continue; }
  if out=$(npx dotenvx decrypt --stdout -f "$src" -fk .env.keys 2> /dev/null) && ! grep -q 'encrypted:' <<< "$out"; then
    ok "can read $env ($(grep -cE '^[A-Z]' <<< "$out" | tr -d ' ') values incl. public key)"
  elif [ "$env" = development ]; then
    bad "cannot read development: npm start will stop. Ask for DOTENV_PRIVATE_KEY_DEVELOPMENT."
  else
    warn "cannot read $env: fine unless you change $env settings or push them to EAS"
  fi
done

node scripts/env-check.mjs > /dev/null 2>&1 && ok "every committed env value is encrypted" || bad "plaintext env value found: run npm run env:check"

[ "$fail" = 0 ] && ok "env setup looks good" || exit 1
