#!/usr/bin/env bash
# A read-only login on LangQuest v2 for the v2 import (docs/v2-import.md), so
# the transfer dashboard shows people's usernames and emails and Next their
# names. It may read each v2 person's id, username and email, nothing else,
# and can change nothing.
#
#   scripts/v2-access.sh       once; running it again rotates the password
#
# Run it yourself: it adds a role to v2's production database. It prints no
# secret, and commits .env.production alone. Then npm run secrets -- production
# puts it on the app's Worker for the scheduled sync (decisions.md 141).
set -euo pipefail
cd "$(dirname "$0")/.."

file=.env.production
ref=unsxkmlcyxgtgmtzfonb   # LangQuest v2's production project
if [ -n "$(git status --porcelain -- "$file")" ]; then
  echo "x $file has uncommitted changes; commit or discard them first." >&2; exit 1
fi

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
mkdir -p "$work/supabase"
# Linked in a folder of its own only to learn v2's pooler address; this repository stays linked to Next.
npx supabase link --project-ref "$ref" --workdir "$work" < /dev/null > /dev/null
[ -f "$work/supabase/.temp/pooler-url" ] || { echo "x could not learn v2's pooler address" >&2; exit 1; }
host=$(sed -E 's#.*@([^:/]+).*#\1#' "$work/supabase/.temp/pooler-url")
pw=$(openssl rand -hex 24)   # hex, so the URL needs no escaping

cat > "$work/role.sql" <<SQL
do \$\$ begin
  if exists (select 1 from pg_roles where rolname = 'v2_reader') then
    alter role v2_reader with login password '$pw';
  else
    create role v2_reader with login password '$pw';
  end if;
end \$\$;
alter role v2_reader set default_transaction_read_only = on;
grant usage on schema public to v2_reader;
grant select (id, username, email) on public.profile to v2_reader;
SQL
npx supabase db query --linked --project-ref "$ref" --workdir "$work" -f "$work/role.sql" > /dev/null
echo "✓ v2_reader can read v2's usernames and emails, and nothing else"

DOTENVX_NO_NATIVE=true npx dotenvx set V2_DATABASE_URL \
  "postgresql://v2_reader.$ref:$pw@$host:5432/postgres" -f "$file" -fk .env.keys > /dev/null
git add "$file"
git commit -q -m "Read-only v2 access for the v2 import" -- "$file"
echo "✓ V2_DATABASE_URL encrypted in $file and committed; npm run secrets -- production puts it on the app's Worker"
