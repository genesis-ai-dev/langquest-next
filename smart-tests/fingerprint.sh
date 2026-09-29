#!/bin/bash
# Content fingerprint of everything a journey exercises. Shared by the Stop
# hook and the ship gate so "green for this code" means the same thing in both.
# Commits alone do not change it; docs-only edits never do.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
git ls-files -co --exclude-standard -- apps/mobile/src apps/mobile/modules apps/mobile/App.tsx \
  apps/mobile/index.ts packages/core/src packages/client/src smart-tests \
  | grep -Ev '^smart-tests/(results|\.hook)/' | xargs shasum 2>/dev/null | shasum | cut -c1-40
