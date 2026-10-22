#!/usr/bin/env bash
# Install Playwright's browsers and the system packages that they need, in
# CI, without a slow package mirror holding a job for many minutes
# (.github/actions/playwright). On 2026-10-22 the runners' Ubuntu mirror,
# azure.archive.ubuntu.com, sent those packages at about 20 kB/s: 15 MB took
# 12 minutes on one ui-web shard, and web-smoke hit its 30-minute limit.
#
#   bash scripts/ci-playwright.sh <cache-dir> <browser>...
#
# The browsers and the .deb files come from <cache-dir> when the cache was
# restored, so a cached run downloads no package. apt retries, gives up on a
# stalled server after 20 seconds, and keeps what it downloads. Each try of
# the install may take 4 minutes; a slow one is stopped and tried again,
# up to three times, and apt resumes where it left off.
set -euo pipefail
cache="$1"; shift
debs="$cache/debs"

sudo tee /etc/apt/apt.conf.d/90ci-playwright > /dev/null <<'CONF'
Acquire::Retries "5";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Keep-Downloaded-Packages "true";
Binary::apt::APT::Keep-Downloaded-Packages "true";
CONF

if compgen -G "$debs/*.deb" > /dev/null; then
  sudo cp "$debs"/*.deb /var/cache/apt/archives/
  echo "Restored $(ls "$debs"/*.deb | wc -l) cached packages."
fi

for try in 1 2 3; do
  if timeout 240 npx playwright install --with-deps "$@"; then
    mkdir -p "$debs"
    cp /var/cache/apt/archives/*.deb "$debs"/ 2> /dev/null || true
    exit 0
  fi
  echo "::warning::Installing Playwright's browsers did not finish within 4 minutes (try $try of 3); trying again."
  # timeout stops npx, not the apt it started: stop that too, and finish any half-done package setup.
  sudo pkill -f 'apt-get' || true
  sleep 2
  sudo dpkg --configure -a || true
done
echo "::error::Playwright's browsers could not be installed in three tries; the package mirror may be down."
exit 1
