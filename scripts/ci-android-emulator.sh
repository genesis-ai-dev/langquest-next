#!/bin/bash
# An Android emulator on a GitHub Linux runner, for the nightly phone tests
# (.github/workflows/phone-tests.yml, decision 206):
#
#   bash scripts/ci-android-emulator.sh <log file>
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
LOG="${1:?usage: ci-android-emulator.sh <log file>}"
API="${ANDROID_API:-35}"
IMAGE="system-images;android-${API};google_apis;x86_64"
AVD=phone-tests
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:?the Android SDK is not set up}}"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/emulator:$SDK/platform-tools:$PATH"

# KVM for the runner's user.
echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | sudo tee /etc/udev/rules.d/99-kvm4all.rules > /dev/null
sudo udevadm control --reload-rules
sudo udevadm trigger --name-match=kvm
[ -w /dev/kvm ] || { echo "::error::/dev/kvm is not there or not writable: this runner cannot run the Android emulator at speed"; exit 1; }

yes | sdkmanager --licenses > /dev/null 2>&1 || true
sdkmanager --install "$IMAGE" emulator platform-tools > /dev/null
echo no | avdmanager create avd --force -n "$AVD" -k "$IMAGE" -d pixel_6 > /dev/null
# A bigger data partition and more memory than the defaults: the app keeps its
# languages in SQLite and the files the flows record.
CONFIG="$HOME/.android/avd/$AVD.avd/config.ini"
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
