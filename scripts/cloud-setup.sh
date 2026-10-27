#!/bin/bash
# A Claude Code cloud machine made ready for this repo, with what the
# guardrails CI jobs have (.github/workflows/guardrails.yml), so a cloud thread
# runs `npm run guardrails -- --all` as a Mac does (AGENTS.md, Cloud threads).
#
#   bash scripts/cloud-setup.sh              at the start of a cloud thread
#   bash scripts/cloud-setup.sh --snapshot   as the cloud environment's setup script
#
# The project's cloud environment runs this before Claude starts, as root,
# from the folder above the repos (its setup script is the one line
# `bash langquest-next/scripts/cloud-setup.sh --snapshot || true`). When that
# takes under about five minutes, the machine it leaves is kept as a snapshot
# that later threads start from, so a thread's own run finds everything done
# and takes seconds. --snapshot also stops Docker at the end, so the snapshot
# keeps its files at rest.
#
# What it does, each step skipped when already done:
#   Node 24, as CI (the machine comes with 22 first on PATH)
#   the full git history (the clone is shallow; `npm run server-calls` reads
#     the commits that store builds were made from)
#   npm ci, when package-lock.json or Node changed since the last one
#   Docker running, pulling Docker Hub's images through Google's copy of it
#   the local stack's images, with an edge runtime that trusts the machine's
#     proxy, and the job container's base image
#   Playwright's Chromium, Firefox and WebKit, for web-smoke and ui-web
#
# A step that fails says so and the rest still run; it exits non-zero at the
# end, and running it again tries that step again. Linux and root only: it
# changes the machine, so it never runs on a Mac.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

snapshot=false
case "${1:-}" in
  '') ;;
  --snapshot) snapshot=true ;;
  *) echo "usage: bash scripts/cloud-setup.sh [--snapshot]" >&2; exit 2 ;;
esac
if [ "$(uname -s)" != Linux ] || [ "$(id -u)" -ne 0 ]; then
  echo "cloud-setup.sh sets up a Claude Code cloud machine (Linux, as root); this is not one" >&2
  exit 2
fi

# The stack's services that the tests do not use, as CI leaves them out
# (guardrails.yml); scripts/guardrails.sh starts the stack with the same.
export SUPABASE_EXCLUDE="${SUPABASE_EXCLUDE:-studio,imgproxy,vector,logflare,supavisor}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
state=/var/lib/langquest-cloud-setup
mkdir -p "$state"
failed=()
step() { printf '\n== %s\n' "$1"; }
fail() { echo "! $1"; failed+=("$1"); }

step "Node 24"
node24=/opt/node24
export PATH="$node24/bin:$PATH"
if [ "$("$node24/bin/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != 24 ]; then
  base=https://nodejs.org/dist/latest-v24.x
  if sums="$(curl -fsSL --retry 3 "$base/SHASUMS256.txt")" &&
    file="$(awk '/ node-v24\.[0-9.]+-linux-x64\.tar\.xz$/ { print $2 }' <<< "$sums")" && [ -n "$file" ] &&
    curl -fsSL --retry 3 -o "/tmp/$file" "$base/$file" &&
    (cd /tmp && grep " $file\$" <<< "$sums" | sha256sum --check --status); then
    rm -rf "$node24" && mkdir -p "$node24" && tar -xJf "/tmp/$file" -C "$node24" --strip-components=1
    rm -f "/tmp/$file"
  else
    fail "could not download Node 24 from nodejs.org"
  fi
fi
# Every shell on the machine finds node in /opt/node22/bin first, so Node
# 24's commands go there; the ones that came with 22 are kept beside them.
if [ -x "$node24/bin/node" ]; then
  bin=/opt/node22/bin
  [ -d "$bin" ] || bin=/usr/local/bin
  for tool in node npm npx corepack; do
    [ -e "$node24/bin/$tool" ] || continue
    if [ -e "$bin/$tool" ] && [ ! -L "$bin/$tool" ] && [ ! -e "$bin/$tool-22" ]; then mv "$bin/$tool" "$bin/$tool-22"; fi
    ln -sfn "$node24/bin/$tool" "$bin/$tool"
  done
  echo "node $("$bin/node" -v) in $bin"
fi

step "Full git history"
if [ "$(git rev-parse --is-shallow-repository)" = true ]; then
  GIT_TERMINAL_PROMPT=0 git fetch -q --unshallow origin && echo "fetched" || fail "could not fetch the full git history"
else
  echo "already there"
fi

step "Packages (npm ci)"
want="$(sha256sum package-lock.json | cut -d' ' -f1) $(node -v)"
if [ "$(cat node_modules/.cloud-setup 2>/dev/null)" = "$want" ]; then
  echo "already installed"
elif npm ci --no-audit --no-fund --loglevel=error; then
  echo "$want" > node_modules/.cloud-setup
else
  fail "npm ci failed"
fi

# Playwright's browsers and the system packages they need, while Docker
# works below; Chromium comes with the machine when its version matches.
step "Playwright browsers (in the background)"
playwright="playwright $(node -p "require('playwright-core/package.json').version" 2>/dev/null || echo none)"
browsers=
if [ "$(cat "$state/playwright" 2>/dev/null)" = "$playwright" ]; then
  echo "already installed ($playwright)"
else
  rm -f "$state/playwright"
  (
    env -u PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD npx playwright install --with-deps chromium firefox webkit > "$state/playwright.log" 2>&1 &&
      echo "$playwright" > "$state/playwright"
  ) &
  browsers=$!
fi

step "Docker"
# Docker Hub rations anonymous pulls by address, and cloud machines share
# theirs: node:24-slim got 429 Too Many Requests here on 2026-10-27, and ECR
# Public's copy "Data limit exceeded". Google's copy of Docker Hub served it.
mirror='{"registry-mirrors": ["https://mirror.gcr.io"]}'
mkdir -p /etc/docker
if [ -s /etc/docker/daemon.json ]; then
  jq ". + $mirror" /etc/docker/daemon.json > /tmp/daemon.json && mv /tmp/daemon.json /etc/docker/daemon.json
else
  echo "$mirror" > /etc/docker/daemon.json
fi
if docker info > /dev/null 2>&1; then
  pkill -HUP -x dockerd || true # reads registry-mirrors again
else
  setsid nohup dockerd > /var/log/dockerd.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do docker info > /dev/null 2>&1 && break; sleep 1; done
fi
docker info > /dev/null 2>&1 && echo "running" || fail "dockerd did not start (/var/log/dockerd.log)"

step "The local stack's images"
cli="$(node -p "require('supabase/package.json').version" 2>/dev/null || echo none)"
images="supabase $cli without $SUPABASE_EXCLUDE"
if ! docker info > /dev/null 2>&1; then
  fail "no Docker, so no images"
elif [ "$(cat "$state/images" 2>/dev/null)" = "$images" ]; then
  echo "already pulled ($images)"
elif [ -n "$(docker ps -q --filter 'name=^supabase_db_')" ]; then
  echo "the stack is running, so its images are here"
# A start pulls what the stack needs.
elif bash scripts/ci-retry-pull.sh npx supabase start -x "$SUPABASE_EXCLUDE" > "$state/stack.log" 2>&1; then
  npx supabase stop --no-backup > /dev/null 2>&1
  if bash scripts/ci-docker-images.sh warm > /dev/null; then
    echo "$images" > "$state/images"
    echo "pulled ($images, and the job container's)"
  else
    fail "could not pull the job container's images"
  fi
else
  fail "supabase start failed ($state/stack.log)"
fi

# The machine's outbound HTTPS goes through a proxy that re-signs it with an
# authority the machine trusts (/usr/local/share/ca-certificates) and
# containers do not. Edge Functions load their npm packages as they start, so
# in the local stack every call failed ("invalid peer certificate:
# UnknownIssuer"), and with it every P0 UI test that signs someone in. The
# edge runtime's image gets the machine's authorities, under its own name,
# which the Supabase CLI then runs as it is.
step "Edge runtime trusts the machine's proxy"
cas="$(cat /usr/local/share/ca-certificates/*.crt 2>/dev/null | sha256sum | cut -c1-16)"
edge_images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '(^|/)supabase/edge-runtime:' || true)"
if ! docker info > /dev/null 2>&1; then
  echo "no Docker"
elif [ -z "$edge_images" ]; then
  echo "no edge runtime image yet; run this again after the stack first starts"
fi
for image in $edge_images; do
  if [ "$(docker image inspect -f '{{index .Config.Labels "langquest.cloud-setup.cas"}}' "$image")" = "$cas" ]; then
    echo "$image already does"
    continue
  fi
  dir="$(mktemp -d)"
  cp /usr/local/share/ca-certificates/*.crt "$dir"/
  printf '%s\n' 'ARG BASE' 'FROM ${BASE}' 'COPY *.crt /usr/local/share/ca-certificates/' 'RUN update-ca-certificates' \
    'ENV DENO_TLS_CA_STORE=mozilla,system SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt' \
    "LABEL langquest.cloud-setup.cas=$cas" > "$dir/Dockerfile"
  if docker build -q --build-arg "BASE=$image" -t "$image" "$dir" > /dev/null; then
    echo "$image does now"
    [ -n "$(docker ps -q --filter 'name=^supabase_edge_runtime_')" ] &&
      echo "  the running stack still has the old one: npx supabase stop, then npm run db:start"
  else
    fail "could not give $image the machine's authorities"
  fi
  rm -rf "$dir"
done

if [ -n "$browsers" ]; then
  step "Playwright browsers"
  wait "$browsers"
  [ "$(cat "$state/playwright" 2>/dev/null)" = "$playwright" ] && echo "installed ($playwright)" ||
    fail "Playwright's browsers did not install ($state/playwright.log)"
fi

if $snapshot; then
  step "Docker stopped for the snapshot"
  pkill -x dockerd && for _ in $(seq 1 30); do pgrep -x dockerd > /dev/null || break; sleep 1; done
  echo "stopped"
fi

if [ "${#failed[@]}" -gt 0 ]; then
  printf '\ncloud setup: %d step(s) failed:\n' "${#failed[@]}"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
printf '\ncloud setup: ready\n'
