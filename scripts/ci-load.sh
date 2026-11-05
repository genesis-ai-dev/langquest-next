#!/bin/bash
# Record how loaded a CI runner is while a job runs, so "the same test takes
# 14.8 s there and 2.6 s on a laptop" can be read from numbers instead of
# guessed at (decisions.md 102, amended 2026-10-20).
#
#   ci-load.sh start <dir>            note nproc and free -m, then sample in the background:
#                                     vmstat every 5 s (run queue, swap, CPU idle/steal/iowait)
#                                     and the busiest processes every 30 s
#   ci-load.sh stop <dir> <out-dir>   stop sampling and copy <dir> to <out-dir>, to be uploaded
#
# Read vmstat: `r` above the core count for long is CPU starvation; `wa` is
# the disk; `st` is a noisy neighbour; `si`/`so` above 0 is swapping. The
# files are in the job's results artifact, under load/.
set -uo pipefail
command="${1:-}"
dir="${2:-}"
[ -n "$dir" ] || { echo "usage: ci-load.sh start <dir> | stop <dir> <out-dir>" >&2; exit 2; }

case "$command" in
  start)
    mkdir -p "$dir"
    {
      echo "nproc: $(nproc)"
      free -m
      uptime
    } > "$dir/machine.txt" 2>&1
    cat "$dir/machine.txt"
    nohup vmstat -t 5 > "$dir/vmstat.log" 2>&1 &
    echo $! > "$dir/vmstat.pid"
    nohup bash -c 'while true; do date -u +%T; ps -eo pcpu,pmem,rss,comm --sort=-pcpu | head -8; sleep 30; done' > "$dir/busiest.log" 2>&1 &
    echo $! > "$dir/busiest.pid"
    ;;
  stop)
    out="${3:-}"
    [ -n "$out" ] || { echo "usage: ci-load.sh stop <dir> <out-dir>" >&2; exit 2; }
    for pid in "$dir"/*.pid; do
      [ -f "$pid" ] && kill "$(cat "$pid")" 2> /dev/null
    done
    mkdir -p "$out"
    cp "$dir"/*.log "$dir"/machine.txt "$out"/ 2> /dev/null
    # The samples, summarised: a glance at whether the runner was starved.
    awk 'NR > 2 && $1 ~ /^[0-9]+$/ { n++; r += $1; if ($1 > rmax) rmax = $1; idle += $15; if ($15 < idlemin) idlemin = $15; if (n == 1) idlemin = $15; wa += $16; st += $17 }
         END { if (n) printf "vmstat: %d samples, run queue mean %.1f max %d, cpu idle mean %.0f%% min %d%%, iowait mean %.0f%%, steal mean %.0f%%\n", n, r / n, rmax, idle / n, idlemin, wa / n, st / n }' "$dir/vmstat.log" 2> /dev/null
    ;;
  *)
    echo "usage: ci-load.sh start <dir> | stop <dir> <out-dir>" >&2
    exit 2
    ;;
esac
