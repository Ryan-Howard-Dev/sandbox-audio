#!/usr/bin/env bash
# Minimal Android smoke E2E — bootstrap + one playback probe (emulator only).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EMU_SERIAL="${EMU_SERIAL:-emulator-5554}"
PACKAGE="rd.sheepskin.sandboxmusic"
APK="$ROOT/android/app/build/outputs/apk/debug/app-x86_64-debug.apk"

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
  npm run build:android:apk
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
deeplink 'check-ytdlp'
sleep 6

artist="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Kanye West'))")"
track="$(python3 -c "import urllib.parse; print(urllib.parse.quote('FATHER'))")"
deeplink "play-artist-track?artist=${artist}&track=${track}"
wait_logcat 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 240 || { echo 'Smoke FAIL: play-artist-track'; exit 1; }

echo 'SMOKE PASS: bootstrap + artist-track-play'
