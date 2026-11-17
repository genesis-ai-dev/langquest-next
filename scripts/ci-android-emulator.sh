#!/bin/bash
# An Android emulator on a GitHub Linux runner, for the nightly phone tests
# (.github/workflows/phone-tests.yml, decision 208):
#
#   bash scripts/ci-android-emulator.sh <log file> [<why file>]
#   bash scripts/ci-android-emulator.sh --kvm     only give the runner KVM
#
# GitHub's Linux runners have KVM, which the emulator needs to run at a
# usable speed; the runner's user is given the device first. The system
# image is Google APIs (no Play Store), as the run-app skill says: the Play
# image stays "unauthorized" to adb until someone taps its prompt. It boots
# with no window and no snapshot, and the script returns when Android says
# the boot is complete (at most 10 minutes), the image's own setup app has
# set up the phone (at most 90 s), and a network reaches the internet (at
# most 4 minutes more), as emulator-5554. When a start fails, the script
# keeps what the phone said about its network, stops the emulator and starts
# it again with its data wiped, ANDROID_BOOTS times in all (2 by default).
# When every start fails, it writes one sentence on why to the why file,
# which the run's report gives as the reason no flow ran (phone-tests.mjs).
#
# ANDROID_API picks the Android version (35 by default). The emulator's own
# output goes to the log file, which the workflow keeps; an earlier start's
# output, and what the phone said about its network, go beside it
# (<log>-start<n>.log, <log>-start<n>-network.txt, <log>-start<n>-logcat.txt).
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

LOG="${1:?usage: ci-android-emulator.sh <log file> [<why file>] | --kvm}"
WHY="${2:-}"
BOOTS="${ANDROID_BOOTS:-2}"
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

# The image's own setup app (Google SDK setup) does what a new phone's owner
# would: it marks the phone as set up, turns Wi-Fi on and saves the
# emulator's Wi-Fi network, AndroidWifi. Android gives mobile data only to a
# phone that is set up. The app runs as the home screen once the boot is
# complete and the user is unlocked, which can be a few seconds after
# sys.boot_completed. The script turns it off after that (it can stop
# answering on a slow first boot, run 9, 2026-11-12), so it first waits for
# it. Turned off before it ran, the phone had Wi-Fi off, no saved network and
# no mobile data, and no step below gave it a network (run 60, 2026-11-17,
# LAN-283). When the app has not done its work in 90 s, the script does the
# same steps itself.
setup_app=com.google.android.googlesdksetup
setting() { adb shell settings get "$1" "$2" 2> /dev/null | tr -d '\r' || true; }
set_up() { [ "$(setting global device_provisioned)" = 1 ] && [ "$(setting global wifi_on)" = 1 ]; }
set_up_by_script() {
  local _
  adb shell settings put global device_provisioned 1 || true
  adb shell settings put secure user_setup_complete 1 || true
  adb shell svc wifi enable || true
  for _ in $(seq 1 10); do
    adb shell cmd wifi status 2> /dev/null | tr -d '\r' | grep 'Wifi is enabled' > /dev/null && break
    sleep 2
  done
  adb shell cmd wifi connect-network AndroidWifi open > /dev/null 2>&1 || true
  adb shell svc data enable || true
}
setup_phone() {
  local _
  # No "isn't responding" box over the flows (run 9), from here on.
  adb shell settings put global hide_error_dialogs 1 || true
  for _ in $(seq 1 18); do
    set_up && break
    sleep 5
  done
  if set_up; then
    echo "The image's setup app has set up the phone."
    adb shell pm disable-user --user 0 "$setup_app" > /dev/null 2>&1 || true
  else
    echo "::warning::The image's setup app did not set up the phone in 90 s: the script turns it off and does its steps"
    adb shell pm disable-user --user 0 "$setup_app" > /dev/null 2>&1 || true
    set_up_by_script
  fi
}

# A network that reaches the internet before the flows start. The image can
# boot with no network at all (Wi-Fi off or not joined, no mobile data); the
# app then rightly calls the phone offline, and every flow that downloads
# fails (run 34, 2026-11-13: 6 of 25). The script reads Android's default
# network and waits until Android has checked that it reaches the internet
# (VALIDATED, what the app reads as online). While it has none, it tries in
# turn: waiting, the setup app's steps again (Wi-Fi on, AndroidWifi joined,
# mobile data on), the emulator's modem back on its home network, airplane
# mode on and off. Each step's result goes to the job's log. A start that
# never gets a network fails here, as a machine, not in the flows.
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
# Whole outputs into tr, never cut short by the reader: a reader that stops
# early leaves "tr: write error: Broken pipe" in the log.
one_line() { tr -d '\r' | tr '\n' ' ' | cut -c "1-${1:-600}"; }
say_network() {
  echo "  $(default_network | one_line)"
  echo "  Modem: $(adb emu gsm status 2> /dev/null | grep -v '^OK' | one_line 200)"
  echo "  Wi-Fi: $(adb shell cmd wifi status 2> /dev/null | one_line 300)"
  echo "  Set up: device_provisioned=$(setting global device_provisioned) wifi_on=$(setting global wifi_on) mobile_data=$(setting global mobile_data)"
}
network() {
  local step
  for step in wait setup modem airplane; do
    case $step in
      wait) ;;
      setup) set_up_by_script ;;
      modem) adb emu gsm voice home > /dev/null 2>&1 || true
             adb emu gsm data home > /dev/null 2>&1 || true
             adb shell svc data enable || true ;;
      airplane) adb shell cmd connectivity airplane-mode enable || true
                sleep 10
                adb shell cmd connectivity airplane-mode disable || true ;;
    esac
    if wait_online 12; then
      echo "The emulator reaches the internet (after: $step)"
      say_network
      return 0
    fi
    echo "No network that reaches the internet after 60 s (after: $step)"
    say_network
  done
  return 1
}

# What the phone said about its network, kept beside the emulator's log for
# the next person who reads a start that failed: the radio's own log is in
# logcat's radio buffer, which the job's log keeping leaves out.
keep_network_state() {
  local base="${LOG%.log}-start$1"
  {
    echo "== Default network"; default_network
    echo "== Wi-Fi"; adb shell cmd wifi status 2> /dev/null | tr -d '\r'
    echo "== Saved Wi-Fi networks"; adb shell cmd wifi list-networks 2> /dev/null | tr -d '\r'
    echo "== Wi-Fi networks in range"; adb shell cmd wifi list-scan-results 2> /dev/null | tr -d '\r'
    echo "== Settings"
    for s in device_provisioned wifi_on mobile_data airplane_mode_on; do echo "$s=$(setting global "$s")"; done
    echo "user_setup_complete=$(setting secure user_setup_complete)"
    echo "== Modem"; adb emu gsm status 2> /dev/null | tr -d '\r'
    echo "== Interfaces"; adb shell ip -o addr 2> /dev/null | tr -d '\r'
    echo "== Properties"; adb shell getprop 2> /dev/null | tr -d '\r' | grep -E 'qemu|wifi|net\.|gsm\.' || true
    echo "== Connectivity"; connectivity
  } > "$base-network.txt" 2>&1 || true
  adb logcat -b all -d > "$base-logcat.txt" 2> /dev/null || true
}

EMULATOR_PID=
start_emulator() {
  local wipe=()
  [ "$1" -gt 1 ] && wipe=(-wipe-data)
  nohup emulator -avd "$AVD" -no-window -no-audio -no-boot-anim -no-snapshot "${wipe[@]}" -gpu swiftshader_indirect \
    -cores 2 -dns-server 8.8.8.8,1.1.1.1 > "$LOG" 2>&1 &
  EMULATOR_PID=$!
  timeout 300 adb wait-for-device || return 1
  local _
  for _ in $(seq 1 120); do
    [ "$(adb shell getprop sys.boot_completed 2> /dev/null | tr -d '\r')" = 1 ] && return 0
    sleep 5
  done
  return 1
}

# Stops the emulator (its qemu process, which the emulator command may hand
# over to), and netsimd, the emulator's Wi-Fi beside it, so the next start
# brings up a new one. A lock a killed emulator left would stop the next.
stop_emulator() {
  local _
  adb emu kill > /dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    pgrep -f qemu-system-x86_64 > /dev/null || break
    sleep 2
  done
  kill -9 "$EMULATOR_PID" 2> /dev/null || true
  pkill -9 -f qemu-system-x86_64 2> /dev/null || true
  pkill -9 -x netsimd 2> /dev/null || true
  rm -rf "$ANDROID_AVD_HOME/$AVD.avd/"*.lock
  adb kill-server > /dev/null 2>&1 || true
}

why=()
for boot in $(seq 1 "$BOOTS"); do
  if [ "$boot" -gt 1 ]; then
    mv "$LOG" "${LOG%.log}-start$((boot - 1)).log" 2> /dev/null || true
    echo "::warning::Starting the Android emulator again, with its data wiped (start $boot of $BOOTS)"
  fi
  if ! start_emulator "$boot"; then
    echo "The Android emulator did not finish booting in 10 minutes (start $boot of $BOOTS)"
    tail -50 "$LOG" || true
    why+=("Start $boot: did not finish booting in 10 minutes.")
  else
    adb shell input keyevent 82 || true
    adb shell settings put global stay_on_while_plugged_in 7 || true
    setup_phone
    if network; then
      echo "The emulator is up: $(adb shell getprop ro.build.version.release | tr -d '\r') (API $API), on start $boot of $BOOTS"
      exit 0
    fi
    echo "No network that reaches the internet after 4 minutes (start $boot of $BOOTS)"
    keep_network_state "$boot"
    why+=("Start $boot: no network that reaches the internet.")
  fi
  stop_emulator
done

said="The Android emulator started $BOOTS times. ${why[*]}"
echo "::error::$said"
if [ -n "$WHY" ]; then
  mkdir -p "$(dirname "$WHY")"
  echo "$said" > "$WHY"
fi
exit 1
