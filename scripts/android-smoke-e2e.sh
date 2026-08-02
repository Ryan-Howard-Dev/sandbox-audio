#!/usr/bin/env bash
# Minimal Android smoke E2E — bootstrap + one playback probe (emulator only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EMU_SERIAL="${EMU_SERIAL:-emulator-5554}"
PACKAGE="rd.sheepskin.sandboxmusic"
APK="$ROOT/android/app/build/outputs/apk/gplay/debug/app-gplay-x86_64-debug.apk"

deeplink() {
  local path="$1"
  adb -s "$EMU_SERIAL" shell "am start -a android.intent.action.VIEW -d 'sandboxmusic://e2e/${path}' -f 0x14000000 ${PACKAGE}" >/dev/null 2>&1 || true
  sleep 2
}

wait_logcat() {
  local pattern="$1"
  local timeout="${2:-120}"
  local deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if adb -s "$EMU_SERIAL" logcat -d -s 'Capacitor/Console:*' -t 8000 2>/dev/null | grep -Eq "$pattern"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  SANDBOX_ANDROID_E2E=true npm run build:android:apk
fi

[[ -f "$APK" ]] || { echo "APK not found: $APK"; exit 1; }

adb -s "$EMU_SERIAL" install -r "$APK" >/dev/null
adb -s "$EMU_SERIAL" logcat -c >/dev/null
adb -s "$EMU_SERIAL" shell am force-stop "$PACKAGE" >/dev/null
sleep 2

deeplink 'skip-onboarding'
sleep 15
wait_logcat 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90 || { echo 'Smoke FAIL: skip-onboarding'; exit 1; }

deeplink 'clear-server'
sleep 4

# A smoke test asks one question: does the app boot and play audio? It used to ask that via
# a YouTube-sourced track, which cannot be fetched from a datacenter IP (R-017), so it failed
# for a reason unrelated to the build every single time. Internet Archive serves runner IPs
# normally, so this asserts the same thing and actually means something.
audio_url="$(python3 -c "import urllib.parse; print(urllib.parse.quote('https://archive.org/download/testmp3testfile/mpthreetest.mp3', safe=''))")"
adb -s "$EMU_SERIAL" logcat -c >/dev/null
deeplink "play-direct-url?url=${audio_url}&playTimeoutMs=45000"
wait_logcat 'SandboxE2E.*AREA=direct-url-play RESULT=PASS' 120 || { echo 'Smoke FAIL: play-direct-url'; exit 1; }

echo 'SMOKE PASS: bootstrap + audio playback'
