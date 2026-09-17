#!/usr/bin/env bash
#
# Take the .ipa EAS already built and hand it to TestFlight with altool,
# skipping the `eas submit` queue (which is a separate, slower queue from the
# build queue -- a finished build can sit in it for half an hour).
#
# This is the counterpart to testflight.sh: that one builds locally and needs
# a distribution cert in this machine's keychain, which this Mac does not have.
# Here EAS does the signing and this only does the upload.
#
# Usage:
#   ./scripts/ship-eas-ipa.sh              # cancel pending submit, download, upload
#   ./scripts/ship-eas-ipa.sh --yes        # don't ask before uploading
#   ./scripts/ship-eas-ipa.sh --no-cancel  # leave queued EAS submissions alone
#   ./scripts/ship-eas-ipa.sh --id <uuid>  # a specific build instead of the latest
#
# Credentials come from the environment, same as testflight.sh:
#   ALTOOL_APPLEID_EMAIL           Apple ID that has access to the app
#   ALTOOL_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
# They live in ~/.bash_profile, which zsh does not read, so this sources it
# when the variables are missing rather than failing in a confusing way.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

ASSUME_YES=0
DO_CANCEL=1
BUILD_ID=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1 ;;
    --no-cancel) DO_CANCEL=0 ;;
    --id) BUILD_ID="${2:-}"; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

# ---- preflight ------------------------------------------------------------

step "Preflight"

if [[ -z "${ALTOOL_APPLEID_EMAIL:-}" || -z "${ALTOOL_APP_SPECIFIC_PASSWORD:-}" ]]; then
  # shellcheck disable=SC1090
  [[ -f "$HOME/.bash_profile" ]] && source "$HOME/.bash_profile"
fi
[[ -n "${ALTOOL_APPLEID_EMAIL:-}" ]] || die "ALTOOL_APPLEID_EMAIL is not set (it is in ~/.bash_profile, which zsh does not read)"
[[ -n "${ALTOOL_APP_SPECIFIC_PASSWORD:-}" ]] || die "ALTOOL_APP_SPECIFIC_PASSWORD is not set"
command -v xcrun >/dev/null || die "xcrun not found; install Xcode and run xcode-select --switch"

EAS=(npx --yes eas-cli@latest)

# eas-cli has no `submit:cancel`, so cancelling goes through the GraphQL API
# with the session the CLI already holds.
expo_session() {
  python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.expo/state.json')))['auth']['sessionSecret'])" 2>/dev/null
}

# ---- find the build -------------------------------------------------------

step "Locating the finished build"

RESOLVED="$("${EAS[@]}" build:list --platform ios --limit 10 --json --non-interactive 2>/dev/null \
  | WANT="$BUILD_ID" python3 -c "
import json,os,sys
want = os.environ.get('WANT') or ''
for b in json.load(sys.stdin):
    if want and not b['id'].startswith(want):
        continue
    if b.get('status') != 'FINISHED':
        continue
    url = (b.get('artifacts') or {}).get('applicationArchiveUrl')
    if not url:
        continue
    print(b['id'], b.get('appBuildVersion') or '?', url)
    break
else:
    sys.exit('no finished iOS build with an .ipa found')
")" || die "could not resolve a build (is there a finished iOS build?)"

BUILD_ID="$(awk '{print $1}' <<<"$RESOLVED")"
BUILD_NUM="$(awk '{print $2}' <<<"$RESOLVED")"
IPA_URL="$(awk '{print $3}' <<<"$RESOLVED")"
[[ -n "$IPA_URL" ]] || die "could not resolve an .ipa url"
echo "build $BUILD_ID (build number $BUILD_NUM)"

# ---- cancel the queued EAS submission -------------------------------------
# Otherwise it uploads the same binary later and App Store Connect rejects it
# as a duplicate, which looks like a failure when it is just a race.

if [[ "$DO_CANCEL" == "1" ]]; then
  step "Cancelling queued EAS submissions"
  SESSION="$(expo_session)"
  if [[ -z "$SESSION" ]]; then
    echo "note: no Expo session found; skipping cancel (run 'eas login' if you wanted it)"
  else
    PENDING="$("${EAS[@]}" submit:list --platform ios --limit 5 --json --non-interactive 2>/dev/null | python3 -c "
import json,sys
rows = json.load(sys.stdin)
print(' '.join(r['id'] for r in rows if r.get('status') in ('IN_QUEUE','IN_PROGRESS')))" || true)"
    if [[ -z "${PENDING// /}" ]]; then
      echo "nothing queued"
    else
      for sid in $PENDING; do
        curl -s -X POST https://api.expo.dev/graphql \
          -H 'Content-Type: application/json' \
          -H "expo-session: $SESSION" \
          -d "{\"query\":\"mutation(\$id:ID!){submissions{cancelSubmission(submissionId:\$id){id status}}}\",\"variables\":{\"id\":\"$sid\"}}" \
          | python3 -c "
import json,sys
d = json.load(sys.stdin)
if d.get('errors'):
    print('  cancel failed:', d['errors'][0].get('message','')[:160])
else:
    s = d['data']['submissions']['cancelSubmission']
    print('  cancelled', s['id'][:8], '->', s['status'])"
      done
    fi
  fi
fi

# ---- download -------------------------------------------------------------

step "Downloading the .ipa"

IPA="$(mktemp -d)/langquest-next-$BUILD_NUM.ipa"
curl -fL --progress-bar -o "$IPA" "$IPA_URL" || die "download failed"
ls -lh "$IPA" | awk '{print "  " $9 " (" $5 ")"}'

# Guard against shipping a binary whose build number is not what we just read;
# a duplicate build number is the one altool error that wastes a whole cycle.
PLIST_VERSION="$(unzip -p "$IPA" 'Payload/*.app/Info.plist' 2>/dev/null | plutil -extract CFBundleVersion raw - 2>/dev/null | head -1 || true)"
[[ -n "$PLIST_VERSION" ]] && echo "  CFBundleVersion: $PLIST_VERSION"
if [[ -n "$PLIST_VERSION" && "$PLIST_VERSION" != "$BUILD_NUM" ]]; then
  die "the .ipa says build $PLIST_VERSION but EAS says $BUILD_NUM; refusing to upload a mismatch"
fi

# ---- upload ---------------------------------------------------------------

if [[ "$ASSUME_YES" != "1" ]]; then
  printf '\nUpload build %s to TestFlight as %s? [y/N] ' "$BUILD_NUM" "$ALTOOL_APPLEID_EMAIL"
  read -r reply
  [[ "$reply" == "y" || "$reply" == "Y" ]] || die "aborted"
fi

step "Uploading with altool"

xcrun altool --upload-app \
  -f "$IPA" \
  -t ios \
  -u "$ALTOOL_APPLEID_EMAIL" \
  -p "$ALTOOL_APP_SPECIFIC_PASSWORD"

step "Done"
echo "Build $BUILD_NUM uploaded. Apple still has to process it before it"
echo "appears in TestFlight, which usually takes a few minutes."
