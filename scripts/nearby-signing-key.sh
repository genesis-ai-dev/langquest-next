#!/usr/bin/env bash
# Make the app Worker's Ed25519 key for nearby sync (docs/nearby-sync-plan.md
# 5.12, "The merge"; docs/environments.md), the infrastructure-as-code way.
# A person runs it: it writes a secret, and the app's half goes on to EAS.
#
#   scripts/nearby-signing-key.sh production            make one, if .env.production has none
#   scripts/nearby-signing-key.sh preview
#   scripts/nearby-signing-key.sh production --rotate   a new key; the old public key stays trusted
#
# The private key, one compact JWK with its kid, goes straight from node into
# env-update.sh, which encrypts it into .env.<env> as NEARBY_SIGNING_KEY and
# commits that file. It is never printed, passed as an argument or written down
# in plain text. Its public half, as kid:base64url, is appended to
# NEARBY_CERT_KEYS in apps/web/wrangler.jsonc (committed here) and then to
# EXPO_PUBLIC_NEARBY_CERT_KEYS in apps/mobile/.env.<env> (committed by
# env-update.sh, which then offers to push the app's file to EAS). A rotation
# appends, so phones built before it still trust what the old key signed.
#
# After it: npm run secrets -- <env> puts the key on the app Worker; merging
# deploys the public list with the Worker; npm run env:eas -- push <env> if the
# EAS push was declined here. Until the Worker has both, /api/nearby/* answers
# 503, and until a build or update carries the app's list, phones refuse every
# chain.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=NEARBY_SIGNING_KEY
usage() { echo "usage: scripts/nearby-signing-key.sh <preview|production> [--rotate]" >&2; exit 2; }
env=""; rotate=false
for arg in "$@"; do
  case "$arg" in
    preview|production) env="$arg" ;;
    --rotate) rotate=true ;;
    *) usage ;;
  esac
done
[ -n "$env" ] || usage
[ -f ".env.$env" ] || { echo "x no .env.$env (docs/environments.md)" >&2; exit 1; }

# Key names are plain in the encrypted file; only values are encrypted.
if grep -q "^$KEY=" ".env.$env" && [ "$rotate" = false ]; then
  echo "✓ .env.$env already has $KEY; keeping it (--rotate to make a new one)"
  exit 0
fi
for f in apps/web/wrangler.jsonc "apps/mobile/.env.$env"; do
  [ -z "$(git status --porcelain -- "$f")" ] || { echo "x $f has uncommitted changes; commit or discard them first" >&2; exit 1; }
done

umask 077
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

# Only the public half touches the disk. The kid is the start of the public key's
# hash, so a new key always has a new kid.
node --input-type=module -e '
  import { createHash, generateKeyPairSync } from "node:crypto";
  import { writeFileSync } from "node:fs";
  const { kty, crv, d, x } = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
  const kid = "k" + createHash("sha256").update(Buffer.from(x, "base64url")).digest("hex").slice(0, 8);
  writeFileSync(process.argv[1], `${kid}:${x}\n`);
  process.stdout.write(JSON.stringify({ kty, crv, d, x, kid }) + "\n");
' "$dir/public" | scripts/env-update.sh "$env" "$KEY"

entry="$(cat "$dir/public")"
list="$(node scripts/nearby-cert-keys.mjs "$env" "$entry")"
git add -- apps/web/wrangler.jsonc
git commit -q -m "env($env): the app Worker's nearby key ${entry%%:*} is trusted" -- apps/web/wrangler.jsonc
echo "✓ ${entry%%:*} added to NEARBY_CERT_KEYS ($env) in apps/web/wrangler.jsonc and committed"
echo "  If the next step stops, finish it with: npm run env:update -- $env EXPO_PUBLIC_NEARBY_CERT_KEYS '$list'"
scripts/env-update.sh "$env" EXPO_PUBLIC_NEARBY_CERT_KEYS "$list"

echo "Next: npm run secrets -- $env, then push these commits and merge, so the Worker deploys with the list."
