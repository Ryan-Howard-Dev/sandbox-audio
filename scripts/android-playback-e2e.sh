#!/usr/bin/env bash
# Android playback E2E gate — bootstrap, play spine logcat, progress probe (emulator).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EMU_SERIAL="${EMU_SERIAL:-emulator-5554}"
PACKAGE="rd.sheepskin.sandboxmusic"
APK="$ROOT/android/app/build/outputs/apk/debug/app-x86_64-debug.apk"
REPORT="$ROOT/.android-playback-e2e-report.txt"

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
    local chunk spine
    chunk="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
    spine="$(adb -s "$EMU_SERIAL" logcat -d -s 'Capacitor/Console:I' 'Capacitor/Plugin:V' -t 8000 2>/dev/null || true)"
    update_play_spine_seen "$chunk"
    update_play_spine_seen "$spine"
    if grep -Eq "$pattern" <<<"$chunk"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

SPINE_HANDLE=0
SPINE_PLAYURL=0
SPINE_EXO=0

update_play_spine_seen() {
  local chunk="$1"
  grep -Fq '[handlePlayEnvelope]' <<<"$chunk" && SPINE_HANDLE=1 || true
  grep -Fq 'methodName: playUrl' <<<"$chunk" && SPINE_PLAYURL=1 || true
  grep -Eq '"state":"(playing|buffering)"' <<<"$chunk" && SPINE_EXO=1 || true
}

reset_play_spine_seen() {
  SPINE_HANDLE=0
  SPINE_PLAYURL=0
  SPINE_EXO=0
}

assert_play_spine() {
  local spine
  spine="$(adb -s "$EMU_SERIAL" logcat -d -s 'Capacitor/Console:I' 'Capacitor/Plugin:V' -t 12000 2>/dev/null || true)"
  update_play_spine_seen "$spine"
  local ok=1
  local notes=()

  if (( SPINE_HANDLE == 0 )); then
    ok=0
    notes+=('missing handlePlayEnvelope log')
  fi
  if (( SPINE_PLAYURL == 0 )); then
    ok=0
    notes+=('missing NativeExoPlayback.playUrl')
  fi
  if (( SPINE_EXO == 0 )); then
    ok=0
    notes+=('Exo never reached playing/buffering')
  fi

  if (( ok == 0 )); then
    echo "PLAY SPINE FAIL: ${notes[*]}"
    return 1
  fi
  echo 'PLAY SPINE PASS: handlePlayEnvelope + playUrl + Exo active'
  return 0
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
wait_logcat 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90 || { echo 'Playback E2E FAIL: skip-onboarding'; exit 1; }

deeplink 'probe-handlers'
wait_logcat 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90 || { echo 'Playback E2E FAIL: handlers-probe'; exit 1; }

deeplink 'clear-server'
deeplink 'check-ytdlp'
sleep 8

artist="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Kanye West'))")"
track="$(python3 -c "import urllib.parse; print(urllib.parse.quote('FATHER'))")"

adb -s "$EMU_SERIAL" logcat -c >/dev/null
reset_play_spine_seen
deeplink "play-artist-track?artist=${artist}&track=${track}&progressSeconds=25&integritySeconds=0"
wait_logcat 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 360 || { echo 'Playback E2E FAIL: artist-track-play'; exit 1; }
wait_logcat 'SandboxE2E.*AREA=playback-progress RESULT=PASS' 120 || { echo 'Playback E2E FAIL: playback-progress'; exit 1; }
assert_play_spine || { echo 'Playback E2E FAIL: play spine'; exit 1; }

{
  echo '# Android Playback E2E Report'
  echo "Date: $(date -Iseconds)"
  echo "Device: ${EMU_SERIAL} (emulator)"
  echo 'Result: PASS'
  echo '- artist-track-play: PASS'
  echo '- playback-progress: PASS'
  echo '- play spine (handlePlayEnvelope + playUrl + Exo): PASS'
  echo 'Ready for phone install: requires phone-playback-vinyl-e2e.ps1 on physical device'
} >"$REPORT"

echo 'PLAYBACK E2E PASS'
exit 0
