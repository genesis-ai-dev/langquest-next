#!/bin/bash
# An Android emulator on a GitHub Linux runner, for the nightly phone tests
# (.github/workflows/phone-tests.yml, decision 208):
#
#   bash scripts/ci-android-emulator.sh <log file>
#   bash scripts/ci-android-emulator.sh --kvm     only give the runner KVM
#
# GitHub's Linux runners have KVM, which the emulator needs to run at a
# usable speed; the runner's user is given the device first. The system
# image is Google APIs (no Play Store), as the run-app skill says: the Play
# image stays "unauthorized" to adb until someone taps its prompt. It boots
# with no window and no snapshot, and the script returns when Android says
# the boot is complete (at most 10 minutes), as emulator-5554.
#
# ANDROID_API picks the Android version (35 by default). The emulator's own
# output goes to the log file, which the workflow keeps.
set -euo pipefail

# KVM for the runner's user. The udev rule is the usual way; when the node is
# still not writable after it (the Ubuntu 26.04 image on 2026-11-11), the
# mode is set directly. A runner with no /dev/kvm at all fails here.
kvm() {
  if [ ! -e /dev/kvm ]; then
    echo "::error::This runner has no /dev/kvm ($(grep -cE 'vmx|svm' /proc/cpuinfo || true) CPUs show vmx or svm; image ${ImageOS:-?} ${ImageVersion:-?}): it cannot run the Android emulator at speed"
    exit 1
  fi
  echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules > /dev/null
  sudo udevadm control --reload-rules
  sudo udevadm trigger --name-match=kvm
  sudo udevadm settle --timeout=30 || true
  [ -w /dev/kvm ] || sudo chmod 666 /dev/kvm
  [ -w /dev/kvm ] || { echo "::error::/dev/kvm is there but not writable ($(ls -l /dev/kvm)): this runner cannot run the Android emulator at speed"; exit 1; }
  echo "KVM: $(ls -l /dev/kvm)"
}
if [ "${1:-}" = --kvm ]; then kvm; exit 0; fi

LOG="${1:?usage: ci-android-emulator.sh <log file> | --kvm}"
API="${ANDROID_API:-35}"
IMAGE="system-images;android-${API};google_apis;x86_64"
AVD=phone-tests
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?the Android SDK is not set up}}"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/emulator:$SDK/platform-tools:$PATH"

kvm

yes | sdkmanager --licenses > /dev/null 2>&1 || true
sdkmanager --install "$IMAGE" emulator platform-tools > /dev/null
# adb for the job's later steps and Maestro: the Ubuntu 26.04 image has it on
# no PATH of its own (2026-11-11).
[ -n "${GITHUB_PATH:-}" ] && printf '%s\n' "$SDK/platform-tools" "$SDK/emulator" >> "$GITHUB_PATH"
# One place for the AVD, for avdmanager and the emulator alike: on the Ubuntu
# 26.04 image avdmanager did not put it in ~/.android/avd (2026-11-11).
export ANDROID_AVD_HOME="$HOME/.android/avd"
mkdir -p "$ANDROID_AVD_HOME"
echo no | avdmanager create avd --force -n "$AVD" -k "$IMAGE" -d pixel_6 > /dev/null
# A bigger data partition and more memory than the defaults: the app keeps its
# languages in SQLite and the files the flows record.
CONFIG="$ANDROID_AVD_HOME/$AVD.avd/config.ini"
[ -f "$CONFIG" ] || { echo "::error::avdmanager made no $CONFIG"; avdmanager list avd || true; exit 1; }
{
  echo 'disk.dataPartition.size=6G'
  echo 'hw.ramSize=4096'
  echo 'hw.keyboard=yes'
} >> "$CONFIG"

nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
  -cores 2 -dns-server 8.8.8.8,1.1.1.1 > "$LOG" 2>&1 &

adb wait-for-device
for _ in $(seq 1 120); do
  if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; then
    adb shell input keyevent 82 || true
    adb shell settings put global stay_on_while_plugged_in 7 || true
    echo "The emulator is up: $(adb shell getprop ro.build.version.release | tr -d '\r') (API $API)"
    exit 0
  fi
  sleep 5
done
echo "::error::The Android emulator did not finish booting in 10 minutes"
tail -50 "$LOG"
exit 1
