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
# the boot is complete (at most 10 minutes) and a network reaches the
# internet (at most 6 more), as emulator-5554.
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

# A network that reaches the internet before the flows start. The image can
# boot with no network at all (Wi-Fi off or not joined, no mobile data); the
# app then rightly calls the phone offline, and every flow that downloads
# fails (run 34, 2026-11-13: 6 of 25). The script reads Android's default
# network and waits until Android has checked that it reaches the internet
# (VALIDATED, what the app reads as online). While it has none, it tries in
# turn: waiting, the emulator's modem back on its home network with mobile
# data on, Wi-Fi on, airplane mode on and off. Each step's result goes to the
# job's log. A machine that never gets a network fails here, as a machine,
# not in the flows.
#
# Only the default network's own lines count: its block under "Active default
# network" and its NetworkAgentInfo. The rest of `dumpsys connectivity` lists
# apps' requests too, and Google asks for VALIDATED networks there (a check
# that read the whole dump took one of those for a network, run 36,
# 2026-11-13).
connectivity() { adb shell dumpsys connectivity 2> /dev/null | tr -d '\r' || true; }
default_network() {
  local d id
  d=$(connectivity)
  id=$(awk '/^Active default network: [0-9]+/ { print $4; exit }' <<< "$d")
  [ -n "$id" ] || { echo "Active default network: none"; return 0; }
  awk -v id="$id" '/^Active default network:/ { on = 1; n = 0; print; next }
    on && (NF == 0 || ++n > 6) { on = 0 }
    on || index($0, "network{" id "}") { print }' <<< "$d" | grep -v 'REQUEST' || true
}
online() {
  local own
  own=$(default_network)
  grep -q '^Active default network: [0-9]' <<< "$own" && grep -qE '(^|[^A-Z_])VALIDATED([^A-Z_]|$)' <<< "$own"
}
wait_online() {
  local _
  for _ in $(seq 1 "$1"); do
    online && return 0
    sleep 5
  done
  return 1
}
say_network() {
  local own
  own=$(default_network)
  echo "  ${own:0:600}" | tr '\n' ' '
  echo
  echo "  Modem: $(adb emu gsm status 2> /dev/null | tr -d '\r' | grep -v '^OK' | tr '\n' ' ')"
  echo "  Wi-Fi: $(adb shell dumpsys wifi 2> /dev/null | tr -d '\r' | grep -m1 -E '^Wi-Fi is ')"
}
network() {
  local step
  for step in wait modem wifi airplane; do
    case $step in
      wait) ;;
      modem) adb emu gsm voice home > /dev/null 2>&1 || true
             adb emu gsm data home > /dev/null 2>&1 || true
             adb shell svc data enable || true ;;
      wifi) adb shell svc wifi enable || true ;;
      airplane) adb shell cmd connectivity airplane-mode enable || true
                sleep 10
                adb shell cmd connectivity airplane-mode disable || true ;;
    esac
    if wait_online 18; then
      echo "The emulator reaches the internet (after: $step)"
      say_network
      return 0
    fi
    echo "No network that reaches the internet after 90 s (after: $step)"
    say_network
  done
  echo "::error::The Android emulator has no network that reaches the internet after 6 minutes: the app would be offline in every flow"
  return 1
}

nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect \
  -cores 2 -dns-server 8.8.8.8,1.1.1.1 > "$LOG" 2>&1 &

adb wait-for-device
for _ in $(seq 1 120); do
  if [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ]; then
    adb shell input keyevent 82 || true
    adb shell settings put global stay_on_while_plugged_in 7 || true
    # The image's own Google SDK setup app can stop answering on a slow first
    # boot, and Android's "isn't responding" box then covers every screen (run 9,
    # 2026-11-12). The flows need neither: the app is turned off, and Android
    # shows no error boxes.
    adb shell pm disable-user --user 0 com.google.android.googlesdksetup > /dev/null 2>&1 || true
    adb shell settings put global hide_error_dialogs 1 || true
    network || exit 1
    echo "The emulator is up: $(adb shell getprop ro.build.version.release | tr -d '\r') (API $API)"
    exit 0
  fi
  sleep 5
done
echo "::error::The Android emulator did not finish booting in 10 minutes"
tail -50 "$LOG"
exit 1
