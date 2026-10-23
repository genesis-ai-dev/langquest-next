#!/bin/bash
# The container images a CI job pulls from registries that ration anonymous
# pulls per IP address, kept between runs so a job pulls none when the cache
# has them (.github/actions/docker-images, which wraps this in actions/cache).
# Both registries turned jobs away in 2026-10: ECR Public for the Supabase
# CLI's images ("toomanyrequests: Rate exceeded", "Data limit exceeded"),
# Docker Hub for the job container's base image and wrangler's egress image.
#
#   ci-docker-images.sh key [jobs]   the cache key; "jobs" adds the job container's images
#   ci-docker-images.sh prefix       the start of that key, for a cache from an older config
#   ci-docker-images.sh load         docker load what the cache restored, if anything
#   ci-docker-images.sh save [jobs]  docker save what this job pulled, for the cache
#   ci-docker-images.sh warm         pull what wrangler pulls for the job container, with retries
#
# Needs node_modules (the Supabase CLI's version names its images). The images
# are Docker's own file, so a cache holds nothing of ours: no source, no key.
# DOCKERHUB_USERNAME and DOCKERHUB_TOKEN, when set, sign in to Docker Hub first
# (an authenticated pull has a much higher limit); without them everything
# still works, anonymously.
set -euo pipefail
cd "$(dirname "$0")/.."

archive="${RUNNER_TEMP:-/tmp}/docker-images.tar.zst"
dockerfile=apps/web/jobs/Dockerfile
miniflare=node_modules/miniflare/dist/src/index.js

cli_version() { node -e "console.log(JSON.parse(require('fs').readFileSync('node_modules/supabase/package.json','utf8')).version)"; }
# The job container's base image: the FROM line of its Dockerfile.
base_image() { sed -n 's/^FROM \([^ ]*\).*/\1/p' "$dockerfile" | head -1; }
# What `wrangler dev` pulls beside it, to intercept the container's traffic (miniflare names it).
egress_image() { grep -m1 -o 'cloudflare/proxy-everything:[A-Za-z0-9:@._-]*' "$miniflare" 2> /dev/null || true; }

# v2: the v1 job images' cache held node:24-slim alone (68 MB, seen 2026-10-23), saved by a job whose
# stack never pulled; an exact hit is never saved again, so every ui-web shard pulled the stack from ECR.
prefix() { echo "docker-images-v2-${RUNNER_OS:-local}-supabase-$(cli_version)-"; }

key() {
  local jobs="${1:-}" config
  config="$(
    cat supabase/config.toml
    echo "${SUPABASE_EXCLUDE:-}"
    if [ -n "$jobs" ]; then
      base_image
      egress_image
    fi
  )"
  echo "$(prefix)$(echo "$config" | sha256sum | cut -c1-16)${jobs:+-jobs}"
}

signin() {
  if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
    echo "$DOCKERHUB_TOKEN" | docker login --username "$DOCKERHUB_USERNAME" --password-stdin > /dev/null
    echo "signed in to Docker Hub as $DOCKERHUB_USERNAME"
  else
    echo "pulling from Docker Hub anonymously (no DOCKERHUB_USERNAME / DOCKERHUB_TOKEN)"
  fi
}

load() {
  if [ -s "$archive" ]; then
    zstd -dc "$archive" | docker load
  else
    echo "no cached images; the first start pulls them"
  fi
}

save() {
  local jobs="${1:-}" images base
  base="$(base_image)"
  images="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^public\.ecr\.aws/supabase/' || true)"
  # Without the database there was no stack (it failed before pulling), and a cache saved now would be
  # an exact hit that is never saved again.
  if ! grep -q '^public\.ecr\.aws/supabase/postgres:' <<< "$images"; then echo "the stack's images are not here; keeping none"; return 0; fi
  if [ -n "$jobs" ] && [ -n "$base" ] && docker image inspect "$base" > /dev/null 2>&1; then images="$images"$'\n'"$base"; fi
  [ -n "$images" ] || { echo "no images to keep"; return 0; }
  # shellcheck disable=SC2086
  docker save $images | zstd -T0 -3 -q -f -o "$archive"
  echo "kept $(echo "$images" | wc -l | tr -d ' ') images, $(du -h "$archive" | cut -f1)"
}

# Pull with retries: a rationed registry often lets the next try through.
pull() {
  local image="$1" wait
  for attempt in 1 2 3 4; do
    docker pull --quiet "$image" > /dev/null && return 0
    wait=$((15 * 2 ** attempt))
    echo "::warning::could not pull $image (attempt $attempt of 4); trying again in ${wait}s"
    sleep "$wait"
  done
  return 1
}

warm() {
  signin
  local base egress
  base="$(base_image)"
  egress="$(egress_image)"
  # The build uses the base image when it is already here.
  if [ -n "$base" ] && ! docker image inspect "$base" > /dev/null 2>&1; then pull "$base"; fi
  # wrangler pulls this one itself on every start; having pulled it here, with retries, makes that pull a check of the digest.
  if [ -n "$egress" ]; then pull "$egress"; fi
}

case "${1:-}" in
  key) key "${2:-}" ;;
  prefix) prefix ;;
  load) load ;;
  save) save "${2:-}" ;;
  warm) warm ;;
  *) echo "usage: ci-docker-images.sh key|prefix|load|save|warm" >&2; exit 2 ;;
esac
