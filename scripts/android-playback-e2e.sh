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

# A bare "FAIL: <step>" cannot distinguish "the E2E bridge was compiled out of the APK" from
# "the bridge is running and the step genuinely failed" — and those need opposite fixes. Dump
# enough state to tell them apart on the spot instead of guessing from a one-line failure.
diagnose_failure() {
  local step="$1"
  echo "--- diagnostics for ${step} ---"
  local bridge
  bridge="$(adb -s "$EMU_SERIAL" logcat -d 2>/dev/null | grep -c 'SandboxE2E' || true)"
  echo "SandboxE2E log lines: ${bridge}"
  if [[ "$bridge" == "0" ]]; then
    echo "  -> No bridge output at all. Either __SANDBOX_ANDROID_E2E__ was false at build time"
    echo "     (check SANDBOX_ANDROID_E2E reaches vite in scripts/vite-android-build.mjs),"
    echo "     or the deep link never reached the app."
  else
    echo "  -> Bridge is alive; this step failed for an application reason."
  fi
  echo "app process: $(adb -s "$EMU_SERIAL" shell pidof "$PACKAGE" 2>/dev/null || echo 'NOT RUNNING')"
  echo "last SandboxE2E lines:"
  adb -s "$EMU_SERIAL" logcat -d 2>/dev/null | grep 'SandboxE2E' | tail -15 || true
  echo "recent app errors:"
  adb -s "$EMU_SERIAL" logcat -d 2>/dev/null | grep -E 'AndroidRuntime|Capacitor/Console.*(Error|error)' | tail -15 || true
  echo "--- end diagnostics ---"
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
  SANDBOX_ANDROID_E2E=true npm run build:android:apk
fi

[[ -f "$APK" ]] || { echo "APK not found: $APK"; exit 1; }

adb -s "$EMU_SERIAL" install -r "$APK" >/dev/null
adb -s "$EMU_SERIAL" logcat -c >/dev/null
adb -s "$EMU_SERIAL" shell am force-stop "$PACKAGE" >/dev/null
sleep 2

deeplink 'skip-onboarding'
sleep 15
wait_logcat 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90 || { echo 'Playback E2E FAIL: skip-onboarding'; diagnose_failure 'skip-onboarding'; exit 1; }

deeplink 'probe-handlers'
wait_logcat 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90 || { echo 'Playback E2E FAIL: handlers-probe'; diagnose_failure 'handlers-probe'; exit 1; }

deeplink 'clear-server'
deeplink 'check-ytdlp'
sleep 8

artist="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Kanye West'))")"
track="$(python3 -c "import urllib.parse; print(urllib.parse.quote('FATHER'))")"

adb -s "$EMU_SERIAL" logcat -c >/dev/null
reset_play_spine_seen
deeplink "play-artist-track?artist=${artist}&track=${track}&progressSeconds=25&integritySeconds=0"
# Upstream audio (YouTube/Invidious) blocks datacenter IPs, so a CI runner cannot reliably
# fetch a stream — R-017. That is an upstream fact, not a regression, and gating on it would
# make this job permanently red and therefore ignored again. Distinguish the two:
#
#   full   — audio actually played and progressed. Only achievable where the network allows.
#   spine  — intent resolved to an envelope and reached NativeExoPlayback.playUrl, but the
#            stream could not be fetched. This still proves the queue/resolve path, which is
#            what regresses, and is the honest maximum on a blocked runner.
#   fail   — the spine itself broke. A real regression, red regardless of network.
upstream_stream_unavailable() {
  adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null \
    | grep -Eq 'Received HTML instead of audio|no stream available|is not valid JSON'
}

assert_play_spine_reached() {
  local spine
  spine="$(adb -s "$EMU_SERIAL" logcat -d -s 'Capacitor/Console:I' 'Capacitor/Plugin:V' -t 12000 2>/dev/null || true)"
  update_play_spine_seen "$spine"
  (( SPINE_HANDLE == 1 )) || { echo 'spine: missing handlePlayEnvelope'; return 1; }
  (( SPINE_PLAYURL == 1 )) || { echo 'spine: missing NativeExoPlayback.playUrl'; return 1; }
  return 0
}

E2E_RESULT='full'
if wait_logcat 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 360; then
  wait_logcat 'SandboxE2E.*AREA=playback-progress RESULT=PASS' 120 || { echo 'Playback E2E FAIL: playback-progress'; diagnose_failure 'playback-progress'; exit 1; }
  assert_play_spine || { echo 'Playback E2E FAIL: play spine'; diagnose_failure 'play spine'; exit 1; }
else
  if upstream_stream_unavailable && assert_play_spine_reached; then
    E2E_RESULT='spine'
    echo 'PLAY SPINE PASS (degraded): resolve + playUrl reached; upstream audio unavailable on this runner'
  else
    echo 'Playback E2E FAIL: artist-track-play'
    diagnose_failure 'artist-track-play'
    exit 1
  fi
fi

{
  echo '# Android Playback E2E Report'
  echo "Date: $(date -Iseconds)"
  echo "Device: ${EMU_SERIAL} (emulator)"
  if [[ "$E2E_RESULT" == 'full' ]]; then
    echo 'Result: PASS (full)'
    echo '- artist-track-play: PASS'
    echo '- playback-progress: PASS'
    echo '- play spine (handlePlayEnvelope + playUrl + Exo): PASS'
  else
    echo 'Result: PASS (spine only)'
    echo '- artist-track-play: NOT REACHED — upstream audio unavailable (R-017)'
    echo '- playback-progress: NOT REACHED'
    echo '- play spine (handlePlayEnvelope + playUrl): PASS'
    echo 'Audio fetch is blocked for datacenter IPs; run on a physical device for full coverage.'
  fi
  echo 'Ready for phone install: requires phone-playback-vinyl-e2e.ps1 on physical device'
} >"$REPORT"

if [[ "$E2E_RESULT" == 'full' ]]; then
  echo 'PLAYBACK E2E PASS'
else
  echo 'PLAYBACK E2E PASS (spine only — upstream audio unavailable on this runner)'
fi
exit 0
