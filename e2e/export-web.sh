#!/bin/bash
# The development export that web-smoke.sh and ui-web.sh serve: the release
# build for the local stack. Needs e2e/env.sh sourced first.
#
# WEB_EXPORTED=1 says the export is already built: guardrails builds it
# while the stack starts (decisions.md 163), from apps/mobile/.env.development,
# whose Supabase URL and anon key are the local stack's. It is kept only when
# they still are; otherwise, and without WEB_EXPORTED, it is built here.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
settings="$ROOT/apps/mobile/.env.development"
if [ "${WEB_EXPORTED:-}" = 1 ] && [ -f "$ROOT/apps/mobile/dist/version.json" ] &&
  grep -qxF "EXPO_PUBLIC_SUPABASE_URL=\"$EXPO_PUBLIC_SUPABASE_URL\"" "$settings" &&
  grep -qxF "EXPO_PUBLIC_SUPABASE_ANON_KEY=\"$EXPO_PUBLIC_SUPABASE_ANON_KEY\"" "$settings"; then
  echo "using the export built while the stack started (WEB_EXPORTED=1)" >&2
  exit 0
fi
[ "${WEB_EXPORTED:-}" = 1 ] && echo "::warning::the export built early does not have the running stack's Supabase settings (apps/mobile/.env.development); building it again" >&2
# The model is left out: the test microphones are tones, which split as they always have only without it (decision 135).
cd "$ROOT"
NO_SPEECH_MODEL=1 npm run export:web -w mobile -- development
