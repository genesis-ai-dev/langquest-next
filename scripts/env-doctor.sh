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
  name="DOTENV_PRIVATE_KEY_$(echo "$env" | tr a-z A-Z)"
  for src in $(git ls-files -- 'apps/*/.env.'"$env" 'supabase/.env.'"$env"); do
    if out=$(npx dotenvx decrypt --stdout -f "$src" -fk .env.keys 2> /dev/null) && ! grep -q 'encrypted:' <<< "$out"; then
      ok "can read $src"
    elif [ "$env" = development ]; then
      bad "cannot read $src: npm start will stop. Ask for $name."
    else
      warn "cannot read $src: fine unless you change $env settings or deploy $env by hand ($name)"
    fi
  done
done

mismatched=$(node --input-type=module -e '
  import { execFileSync } from "node:child_process";
  import { readFileSync } from "node:fs";
  import { publicKeyMismatches } from "./scripts/env-files.mjs";
  const files = execFileSync("git", ["ls-files", "--", "apps/*/.env.*", "supabase/.env.*"], { encoding: "utf8" })
    .split("\n").filter(Boolean).map((file) => ({ file, text: readFileSync(file, "utf8") }));
  console.log(publicKeyMismatches(files).join(" "));
')
if [ -n "$mismatched" ]; then
  bad "not encrypted with their environment's key: $mismatched (docs/environments.md, re-keying)"
else
  ok "each environment's files share one key"
fi

node scripts/env-check.mjs > /dev/null 2>&1 && ok "every committed env value is encrypted" || bad "plaintext env value found: run npm run env:check"

[ "$fail" = 0 ] && ok "env setup looks good" || exit 1
