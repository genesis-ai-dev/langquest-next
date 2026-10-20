#!/usr/bin/env bash
# Give the database's webhook poke its secret in each hosted environment
# (decisions.md 101, docs/environments.md), the infrastructure-as-code way:
# a new random value is encrypted into .env.<env> and committed by
# env-update.sh, then npm run secrets puts it on the app's Worker and in
# Vault, with the Worker's address.
#
#   scripts/webhook-poke-secret.sh                  preview, then production
#   scripts/webhook-poke-secret.sh preview          one environment
#   scripts/webhook-poke-secret.sh --rotate         replace a secret already set
#   scripts/webhook-poke-secret.sh --yes            apply without asking
#
# An environment that already has the key keeps it unless --rotate; it is
# still applied, so a secret committed but never applied gets there. The
# value is never printed or passed as an argument.
set -euo pipefail
cd "$(dirname "$0")/.."

KEY=WEBHOOK_POKE_SECRET
envs=(); rotate=false; apply_args=()
for arg in "$@"; do
  case "$arg" in
    preview|production) envs+=("$arg") ;;
    --rotate) rotate=true ;;
    --yes) apply_args+=(--yes) ;;
    *) echo "usage: scripts/webhook-poke-secret.sh [preview|production]... [--rotate] [--yes]" >&2; exit 2 ;;
  esac
done
[ ${#envs[@]} -gt 0 ] || envs=(preview production)

for env in "${envs[@]}"; do
  echo "== $env"
  # Key names are plain in the encrypted file; only values are encrypted.
  if grep -q "^$KEY=" ".env.$env" && [ "$rotate" = false ]; then
    echo "✓ .env.$env already has $KEY; keeping it (--rotate to replace)"
  else
    openssl rand -hex 32 | scripts/env-update.sh "$env" "$KEY"
  fi
  # Applying needs the environment's hosted project (docs/environments.md, "Setting up preview").
  if ! grep -q "^\[remotes\.$env\]" supabase/config.toml; then
    echo "  $env has no hosted project yet ([remotes.$env] in supabase/config.toml); the secret is committed and applies when it is set up"
    continue
  fi
  npm run --silent secrets -- "$env" ${apply_args[@]+"${apply_args[@]}"}
done

echo "Push the env commits to main, so a later npm run secrets from main keeps these values."
