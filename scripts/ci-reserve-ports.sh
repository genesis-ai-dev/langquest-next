#!/bin/bash
# Keep the local stack's ports out of the range Linux hands out to outbound
# connections, on a CI runner, before the stack starts.
#
# Every port in supabase/config.toml (54420 to 54429) lies inside the runner's
# ephemeral range (32768 to 60999). While `supabase start` pulls a dozen images
# at once, and retries what a registry rations, an outbound connection can
# hold one of those ports as its own end just when Docker binds it, and the
# start fails: "failed to bind host port for 0.0.0.0:54424 ... address already
# in use" (guardrails run 39490187431, the server job). Reserved ports are
# never handed out, so the bind is the stack's alone.
#
#   bash scripts/ci-reserve-ports.sh
#
# Needs sudo (a GitHub-hosted runner has it); does nothing off Linux.
set -euo pipefail
[ "$(uname -s)" = Linux ] || { echo "not Linux: nothing to reserve"; exit 0; }
root="$(cd "$(dirname "$0")/.." && pwd)"
ports="$(grep -E '^\s*(port|shadow_port|smtp_port|pop3_port)\s*=\s*[0-9]+' "$root/supabase/config.toml" | grep -oE '[0-9]+$' | sort -un | paste -sd, -)"
[ -n "$ports" ] || { echo "no ports found in supabase/config.toml" >&2; exit 1; }
current="$(sysctl -n net.ipv4.ip_local_reserved_ports)"
sudo sysctl -q -w "net.ipv4.ip_local_reserved_ports=${current:+$current,}$ports"
echo "reserved from the outbound range: $(sysctl -n net.ipv4.ip_local_reserved_ports)"
