#!/usr/bin/env bash
#
# Build the iOS app on this machine and upload it to TestFlight with altool.
#
# The EAS path (`eas build -p ios --profile production`) still works and needs
# none of this; this is the local alternative, which trades EAS's managed
# credentials for ones that must live in this machine's keychain.
#
# Usage:
#   ./scripts/testflight.sh              # build, ask, then upload
#   ./scripts/testflight.sh --yes        # build and upload without asking
#   ./scripts/testflight.sh --build-only # stop after the .ipa, upload nothing
#   ./scripts/testflight.sh --clean      # force the prebuild clean flag
#
# Credentials come from the environment:
#   ALTOOL_APPLEID_EMAIL           Apple ID that has access to the app
#   ALTOOL_APP_SPECIFIC_PASSWORD   app-specific password (appleid.apple.com)
# They live in ~/.bash_profile, which zsh does not read, so this sources it
# when the variables are missing rather than failing in a confusing way.

set -euo pipefail

# CocoaPods on macOS system Ruby calls unicode_normalize on the project path
# and dies with an Encoding::CompatibilityError when the locale is not UTF-8.
# Ryder's LANG is exported from .zshrc, so an interactive terminal is fine and
# anything non-interactive (cron, CI, an agent shell) is not.
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-$LANG}"

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

SCHEME="LangQuestNext"
WORKSPACE="ios/$SCHEME.xcworkspace"
TEAM_ID="${APPLE_TEAM_ID:-GW63HDZ4G9}"
BUILD_DIR="$APP_DIR/build/testflight"
ARCHIVE="$BUILD_DIR/$SCHEME.xcarchive"

ASSUME_YES=0
BUILD_ONLY=0
PREBUILD_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --yes|-y) ASSUME_YES=1 ;;
    --build-only) BUILD_ONLY=1 ;;
    --clean) PREBUILD_ARGS+=(--clean) ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

# ---- preflight ------------------------------------------------------------
# Everything that can be known before a twenty-minute build is checked here.

step "Preflight"

if [[ -z "${ALTOOL_APPLEID_EMAIL:-}" || -z "${ALTOOL_APP_SPECIFIC_PASSWORD:-}" ]]; then
  # shellcheck disable=SC1090
  [[ -f "$HOME/.bash_profile" ]] && source "$HOME/.bash_profile"
fi
[[ -n "${ALTOOL_APPLEID_EMAIL:-}" ]] || die "ALTOOL_APPLEID_EMAIL is not set (it is in ~/.bash_profile, which zsh does not read)"
[[ -n "${ALTOOL_APP_SPECIFIC_PASSWORD:-}" ]] || die "ALTOOL_APP_SPECIFIC_PASSWORD is not set"

command -v xcodebuild >/dev/null || die "xcodebuild not found; install Xcode and run xcode-select --switch"

# An App Store archive cannot be signed with a development certificate. This
# is the check that fails on a machine where EAS has always held the
# credentials: `eas credentials` (iOS -> production) can download the
# distribution certificate and profile, or Xcode can create them once you are
# signed in under team $TEAM_ID.
# Set ALLOW_PROVISIONING_UPDATES=1 to skip this and let xcodebuild create the
# certificate itself via -allowProvisioningUpdates (consumes an account slot).
if [[ "${ALLOW_PROVISIONING_UPDATES:-0}" != 1 ]]; then
  security find-identity -v -p codesigning | grep -qE "Apple Distribution|iPhone Distribution" \
    || die "no Apple Distribution certificate in the keychain; run \`eas credentials\` to download this app's, or create one in Xcode (Settings -> Accounts -> Manage Certificates)"
fi

# ---- build number ---------------------------------------------------------
# App Store Connect refuses a build number it has already seen, and the EAS
# builds consumed some. Bump before prebuild so the generated project carries
# the new value.

step "Build number"
BUILD_NUMBER="$(node -e '
  const fs = require("fs");
  const p = "app.json";
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const next = String(Number(j.expo.ios.buildNumber ?? "0") + 1);
  j.expo.ios.buildNumber = next;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
  process.stdout.write(next);
')"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("app.json","utf8")).expo.version')"
echo "$VERSION ($BUILD_NUMBER)"

# ---- generate the native project -----------------------------------------
# ios/ is gitignored and generated: config plugins (expo-camera's camera
# permission, expo-audio's microphone permission) only reach Info.plist here.
# Note that prebuild clears and regenerates ios/ even without --clean, because
# the directory is not tracked in git. Nothing hand-written survives in there;
# native code belongs in modules/ (as microphone-energy does) or in a plugin.

step "Prebuild"
npx expo prebuild --platform ios ${PREBUILD_ARGS[@]+"${PREBUILD_ARGS[@]}"}

# ---- archive --------------------------------------------------------------

step "Archive"
rm -rf "$ARCHIVE"
mkdir -p "$BUILD_DIR"
xcodebuild \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  -allowProvisioningUpdates \
  archive

# ---- export an .ipa -------------------------------------------------------

step "Export"
cat > "$BUILD_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>destination</key><string>export</string>
</dict>
</plist>
PLIST

rm -rf "$BUILD_DIR/export"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$BUILD_DIR/export" \
  -allowProvisioningUpdates

IPA="$(find "$BUILD_DIR/export" -name '*.ipa' -maxdepth 1 | head -1)"
[[ -n "$IPA" ]] || die "no .ipa produced in $BUILD_DIR/export"
echo "built $IPA"

if [[ "$BUILD_ONLY" == 1 ]]; then
  step "Stopping before upload (--build-only)"
  exit 0
fi

# ---- upload ---------------------------------------------------------------
# Validate first: it catches most of what the upload would reject, without
# consuming the build number on App Store Connect.

step "Validate"
xcrun altool --validate-app -f "$IPA" -t ios \
  -u "$ALTOOL_APPLEID_EMAIL" -p "$ALTOOL_APP_SPECIFIC_PASSWORD"

if [[ "$ASSUME_YES" != 1 ]]; then
  printf '\nUpload %s (%s) to TestFlight? [y/N] ' "$VERSION" "$BUILD_NUMBER"
  read -r reply
  [[ "$reply" == [yY]* ]] || { echo "not uploaded"; exit 0; }
fi

step "Upload"
xcrun altool --upload-app -f "$IPA" -t ios \
  -u "$ALTOOL_APPLEID_EMAIL" -p "$ALTOOL_APP_SPECIFIC_PASSWORD"

step "Uploaded $VERSION ($BUILD_NUMBER)"
echo "Processing takes a few minutes before it appears in TestFlight."
