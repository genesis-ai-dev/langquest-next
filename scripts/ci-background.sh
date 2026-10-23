#!/bin/bash
# Run a CI job's slow setup in the background while the job does something
# else, then wait for it (decisions.md 163): the local stack starts while the
# web export builds and the browsers install, instead of one after another.
#
#   ci-background.sh start <name> <command...>   start it; its output goes to $RUNNER_TEMP/<name>.log
#   ci-background.sh wait <name>                 wait for it, print its output, exit as it did
#
# A step that starts something must have a later step that waits for it, or
# its failure is never seen.
set -uo pipefail
dir="${RUNNER_TEMP:-/tmp}"
command="${1:-}"
name="${2:-}"
[ -n "$name" ] || { echo "usage: ci-background.sh start <name> <command...> | wait <name>" >&2; exit 2; }

case "$command" in
  start)
    shift 2
    [ "$#" -gt 0 ] || { echo "usage: ci-background.sh start <name> <command...>" >&2; exit 2; }
    rm -f "$dir/$name.exit"
    nohup bash -c '"$@" > "$0.log" 2>&1; echo $? > "$0.exit"' "$dir/$name" "$@" > /dev/null 2>&1 &
    echo "started $name in the background"
    ;;
  wait)
    start=$SECONDS
    while [ ! -f "$dir/$name.exit" ]; do sleep 2; done
    cat "$dir/$name.log"
    echo "$name ended $((SECONDS - start)) s after this step began waiting"
    exit "$(cat "$dir/$name.exit")"
    ;;
  *)
    echo "usage: ci-background.sh start <name> <command...> | wait <name>" >&2
    exit 2
    ;;
esac
