#!/bin/bash
# The waits of the nightly phone tests (.github/workflows/phone-tests.yml,
# decision 207), each with its limit, so a step that cannot finish fails
# with what it waited for instead of hanging until the job's own limit.
#
#   worker <log>                   the app's Worker answers on :8787 (5 min)
#   tunnel <log> <tunnel.json>     cloudflared has its address; writes it (2 min)
#   job "<job name>" <minutes>     a job of this run has ended (the test server
#                                  serves until the iPhone job ends)
#   simulator <app> <device.json>  makes, boots and installs an iPhone simulator;
#                                  sets UDID for the next steps (10 min)
#   server <dir>                   the test server's address and accounts are in
#                                  this run's artifacts; fails at once if the
#                                  server's job ended without them (60 min)
#   local <log>                    127.0.0.1:54421 answers through the tunnel (6 min)
set -euo pipefail
mode="${1:?usage: phone-tests-wait.sh worker|tunnel|job|simulator|server|local ...}"
shift

# Seconds since the step started, against a limit: polling here is waiting
# on another machine, not a test sleeping.
until_limit() { [ "$SECONDS" -lt "$1" ]; }

case "$mode" in
  worker)
    log="$1"
    while until_limit 300; do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/blobs || true)"
      if [ "$code" != 000 ]; then echo "The Worker answers ($code)."; exit 0; fi
      sleep 5
    done
    echo "::error::The app's Worker did not answer on :8787 in 5 minutes"
    tail -80 "$log" || true
    exit 1
    ;;

  tunnel)
    log="$1" out="$2"
    while until_limit 120; do
      url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1 || true)"
      if [ -n "$url" ]; then
        mkdir -p "$(dirname "$out")"
        printf '{"url":"%s"}\n' "$url" > "$out"
        echo "The tunnel is open."
        exit 0
      fi
      sleep 2
    done
    echo "::error::cloudflared gave no tunnel address in 2 minutes"
    tail -40 "$log" || true
    exit 1
    ;;

  job)
    name="$1" minutes="$2"
    while until_limit $((minutes * 60)); do
      status="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs?per_page=100" \
        --jq ".jobs[] | select(.name == \"$name\") | .status" 2>/dev/null | head -1 || true)"
      if [ "$status" = completed ]; then echo "The job \"$name\" has ended."; exit 0; fi
      sleep 30
    done
    echo "Stopped serving after $minutes minutes."
    ;;

  simulator)
    app="$1" device="$2"
    pick="$(xcrun simctl list -j runtimes devicetypes | node -e '
      let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        const j = JSON.parse(s);
        const ios = j.runtimes.filter((r) => r.isAvailable && r.platform === "iOS").sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
        if (!ios) throw new Error("no iOS simulator runtime");
        const types = (ios.supportedDeviceTypes ?? j.devicetypes).map((t) => t.name).filter((n) => /^iPhone \d+$/.test(n));
        const type = types.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() ?? "iPhone 16";
        console.log([ios.identifier, type, ios.version].join("\t"));
      });')"
    IFS=$'\t' read -r runtime type version <<< "$pick"
    udid="$(xcrun simctl create "Phone tests" "$type" "$runtime")"
    xcrun simctl boot "$udid"
    xcrun simctl bootstatus "$udid" -b > /dev/null
    xcrun simctl install "$udid" "$app"
    mkdir -p "$(dirname "$device")"
    printf '{"device":"%s","os":"iOS %s"}\n' "$type" "$version" > "$device"
    echo "UDID=$udid" >> "$GITHUB_ENV"
    echo "Booted $type on iOS $version ($udid) with the test app."
    ;;

  server)
    dir="$1" last=""
    while until_limit 3600; do
      # A download that works but has no tunnel.json will not get better; a
      # download that fails may be the artifact not listed yet, or GitHub
      # having a bad hour (HTTP 502 on 2026-11-11), so that one is retried.
      if last="$(gh run download "$GITHUB_RUN_ID" --repo "$GITHUB_REPOSITORY" -n phone-tests-ios-server -D "$dir" 2>&1)"; then
        if [ -f "$dir/tunnel.json" ]; then echo "The test server is up."; exit 0; fi
        echo "::error::The iPhone test server's artifact has no tunnel.json"
        ls -la "$dir" || true
        exit 1
      fi
      job="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/jobs?per_page=100" \
        --jq '.jobs[] | select(.name == "iPhone test server") | .status' 2>/dev/null | head -1 || true)"
      if [ "$job" = completed ]; then
        echo "::error::The iPhone test server's job ended without starting the server: read its log"
        exit 1
      fi
      sleep 20
    done
    echo "::error::The iPhone test server was not up after 60 minutes. The last download said:"
    printf '%s\n' "$last" | tail -5
    exit 1
    ;;

  local)
    log="$1"
    while until_limit 360; do
      code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:54421/auth/v1/health || true)"
      if [ "$code" != 000 ] && [ "$code" != 502 ]; then echo "The test server answers through the tunnel ($code)."; exit 0; fi
      sleep 3
    done
    echo "::error::The test server did not answer through the tunnel in 6 minutes"
    tail -40 "$log" || true
    exit 1
    ;;

  *)
    echo "unknown wait: $mode" >&2
    exit 2
    ;;
esac
