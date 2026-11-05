#!/usr/bin/env bash
# Install Playwright's browsers and the system packages that they need, in
# CI, without a slow package mirror holding a job for many minutes
# (.github/actions/playwright). On 2026-10-22 the runners' Ubuntu mirror,
# azure.archive.ubuntu.com, sent those packages at about 20 kB/s: 15 MB took
# 12 minutes on one ui-web shard, and web-smoke hit its 30-minute limit.
#
#   bash scripts/ci-playwright.sh <cache-dir> <browser>...
#
# When the cache was restored (PLAYWRIGHT_CACHE_HIT=true), the cached .deb
# files are installed with dpkg and the browsers come from the cache, with no
# network at all, not even apt-get update; the browsers must then start, or
# the network install below runs. Packages that are not
# cached come from Ubuntu's own servers first, then Azure's mirror. apt retries, gives up on a
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

# The runners fetch packages through a mirror list, with Azure's mirror
# first. When that mirror crawls (2026-10-22: under 50 kB/s for hours),
# Ubuntu's own servers are fast, so they go first and Azure's second.
if [ -f /etc/apt/apt-mirrors.txt ]; then
  printf '%s\n' 'http://archive.ubuntu.com/ubuntu/	priority:1' 'http://azure.archive.ubuntu.com/ubuntu/	priority:2' 'http://security.ubuntu.com/ubuntu/	priority:3' \
    | sudo tee /etc/apt/apt-mirrors.txt > /dev/null
fi

# Whether each browser starts: Playwright refuses to launch one whose system
# libraries are missing, so this fails rather than leave a broken browser.
browsers_start() {
  node -e '
    const pw = require("playwright");
    (async () => {
      for (const name of process.argv.slice(1)) {
        const browser = await pw[name].launch();
        await browser.close();
      }
    })().catch((err) => { console.error(err.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
  ' "$@"
}

# A cache hit: install the cached packages and browsers without the network
# (no apt-get update, which needs the mirror too), and check that the
# browsers start. Anything wrong falls through to the full install below.
if [ "${PLAYWRIGHT_CACHE_HIT:-}" = true ] && compgen -G "$debs/*.deb" > /dev/null; then
  echo "Installing $(ls "$debs"/*.deb | wc -l) cached packages without the network."
  if sudo dpkg -i "$debs"/*.deb > "$RUNNER_TEMP/dpkg.log" 2>&1 && npx playwright install "$@" && browsers_start "$@"; then
    echo "Browsers installed from the cache."
    exit 0
  fi
  tail -20 "$RUNNER_TEMP/dpkg.log" || true
  echo "::warning::The cached browsers or packages did not install cleanly; installing from the network instead."
  sudo dpkg --configure -a || true
fi

if compgen -G "$debs/*.deb" > /dev/null; then
  sudo cp "$debs"/*.deb /var/cache/apt/archives/
fi

for try in 1 2 3; do
  if timeout 240 npx playwright install --with-deps "$@" && browsers_start "$@"; then
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
