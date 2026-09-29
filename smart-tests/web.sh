#!/bin/bash
# The journey web server: the app's web build pointed at local Supabase.
# Expo's own .env loading stays off (as in `npm run web`), so the bundle gets
# exactly the values env.sh exported.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$ROOT/smart-tests/env.sh" || { echo "local Supabase is not running (npm run db:start)" >&2; exit 1; }
cd "$ROOT/apps/mobile"
EXPO_NO_DOTENV=1 exec npx expo start --web --port "${1:-${SMART_PORT:-8091}}"
