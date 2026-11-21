#!/usr/bin/env bash
# Give the read gate's two logins, claude_reader and agent_reader, a password
# on the hosted project, make a new CLAUDE_READ_TOKEN, and keep all three
# encrypted in .env.production (docs/production-reads.md).
#
#   scripts/claude-read-access.sh     on the Mac, once the claude_readers
#                                     migration is on the hosted database
#   npm run secrets -- production     then: two Hyperdrive configs, and the
#                                     token's SHA-256 on the admin Worker
#
# Running it again rotates both passwords and the token. It prints no
# secret: the new token goes to the clipboard, for the cloud environment's
# CLAUDE_READ_TOKEN on claude.ai. It commits .env.production alone.
set -euo pipefail
cd "$(dirname "$0")/.."

file=.env.production
[ -f supabase/.temp/project-ref ] || { echo "x not linked. Run: npx supabase link --project-ref <ref>" >&2; exit 1; }
[ -f supabase/.temp/pooler-url ] || { echo "x no pooler URL in supabase/.temp; run npx supabase link again" >&2; exit 1; }
if [ -n "$(git status --porcelain -- "$file")" ]; then
  echo "x $file has uncommitted changes; commit or discard them first." >&2; exit 1
fi

ref=$(cat supabase/.temp/project-ref)
host=$(sed -E 's#.*@([^:/]+).*#\1#' supabase/.temp/pooler-url)
claude_pw=$(openssl rand -hex 24)   # hex, so the URL needs no escaping
agent_pw=$(openssl rand -hex 24)
token=$(openssl rand -hex 32)

sql=$(mktemp); trap 'rm -f "$sql"' EXIT
printf "alter role claude_reader with login password '%s';\nalter role agent_reader with login password '%s';\n" "$claude_pw" "$agent_pw" > "$sql"
npx supabase db query --linked -f "$sql" > /dev/null
echo "✓ claude_reader and agent_reader can log in on $ref"

# On stdin, not as an argument, which npx would write to npm's debug log.
printf '%s' "postgresql://claude_reader.$ref:$claude_pw@$host:5432/postgres" | node scripts/dotenvx-set.mjs CLAUDE_READ_DATABASE_URL "$file" secret
printf '%s' "postgresql://agent_reader.$ref:$agent_pw@$host:5432/postgres" | node scripts/dotenvx-set.mjs AGENT_READ_DATABASE_URL "$file" secret
printf '%s' "$token" | node scripts/dotenvx-set.mjs CLAUDE_READ_TOKEN "$file" secret
git add "$file"
git commit -q -m "Read gate logins and token for Claude" -- "$file"
echo "✓ CLAUDE_READ_DATABASE_URL, AGENT_READ_DATABASE_URL and CLAUDE_READ_TOKEN encrypted in $file and committed"

if command -v pbcopy > /dev/null; then
  printf '%s' "$token" | pbcopy
  echo "✓ CLAUDE_READ_TOKEN is on the clipboard: paste it into the cloud environment's variables on claude.ai (docs/production-reads.md)"
else
  echo "! no pbcopy: read CLAUDE_READ_TOKEN with npx dotenvx get CLAUDE_READ_TOKEN -f $file when you paste it"
fi
echo "Next: npm run secrets -- production"
