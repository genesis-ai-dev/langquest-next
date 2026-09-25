#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/.." && pwd)"
fixture_dir="$(mktemp -d /tmp/langquest-audio.XXXXXX)"
trap 'rm -rf "$fixture_dir"' EXIT
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=440:sample_rate=44100:duration=1' -ac 1 "$fixture_dir/input.wav"
ffmpeg -hide_banner -loglevel error -f lavfi -i 'sine=frequency=660:sample_rate=48000:duration=1' -ac 2 "$fixture_dir/input.m4a"
xcrun swiftc -module-cache-path "$fixture_dir/modules" \
  "$repo_root/apps/mobile/modules/microphone-energy/ios/AudioRenderer.swift" \
  "$repo_root/apps/mobile/test/nativeAudioRenderer.swift" \
  -o "$fixture_dir/check"
"$fixture_dir/check" "$fixture_dir"
