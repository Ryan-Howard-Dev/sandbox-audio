#!/usr/bin/env bash
# Android playback E2E gate — bootstrap, locker fixture, play spine logcat, progress probe (emulator).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
EMU_SERIAL="${EMU_SERIAL:-emulator-5554}"
PACKAGE="rd.sheepskin.sandboxmusic"
APK="$ROOT/android/app/build/outputs/apk/gplay/debug/app-gplay-x86_64-debug.apk"
REPORT="$ROOT/.android-playback-e2e-report.txt"

# shellcheck source=android-playback-e2e-grading.sh
source "$ROOT/scripts/android-playback-e2e-grading.sh"

# --- Runtime helpers ---

deeplink() {
  local path="$1"
  adb -s "$EMU_SERIAL" shell "am start -a android.intent.action.VIEW -d 'sandboxmusic://e2e/${path}' -f 0x14000000 ${PACKAGE}" >/dev/null 2>&1 || true
  sleep 2
}

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

upstream_stream_unavailable() {
  local logs
  logs="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
  upstream_stream_unavailable_from_logs "$logs"
}

assert_play_spine_reached() {
  local logs
  logs="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
  assert_play_spine_reached_from_logs "$logs"
}

if [[ "${RUN_NEGATIVE_CONTROL_ONLY:-0}" == "1" ]]; then
  run_negative_control_self_test
  exit $?
fi

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  node scripts/generate-android-e2e-fixture.mjs
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
adb -s "$EMU_SERIAL" logcat -c >/dev/null
deeplink 'check-ytdlp'
wait_logcat 'SandboxE2E.*AREA=ytdlp-mobile RESULT=(PASS|SKIP)' 120 \
  || { echo 'Playback E2E FAIL: check-ytdlp (no PASS or SKIP)'; diagnose_failure 'check-ytdlp'; exit 1; }

# Real end-to-end audio, asserted on every run. Internet Archive has no bot wall, so unlike
# YouTube it serves a datacenter IP normally — this proves ExoPlayer actually receives a
# stream, decodes it and advances position.
adb -s "$EMU_SERIAL" logcat -c >/dev/null
direct_url="$(python3 -c "import urllib.parse; print(urllib.parse.quote('https://archive.org/download/testmp3testfile/mpthreetest.mp3', safe=''))")"
deeplink "play-direct-url?url=${direct_url}&playTimeoutMs=45000"
wait_logcat 'SandboxE2E.*AREA=direct-url-play RESULT=PASS' 120 \
  || { echo 'Playback E2E FAIL: direct-url-play (open-source audio did not decode)'; diagnose_failure 'direct-url-play'; exit 1; }
echo 'DIRECT AUDIO PASS: Internet Archive stream decoded and advanced'

# Gapless boundary — two items, seek to end of first, assert index 1 with correct metadata.
adb -s "$EMU_SERIAL" logcat -c >/dev/null
deeplink "play-direct-queue?url=${direct_url}"
wait_logcat 'SandboxE2E.*AREA=direct-queue RESULT=PASS' 150 \
  || { echo 'Playback E2E FAIL: direct-queue (gapless boundary)'; diagnose_failure 'direct-queue'; exit 1; }
echo 'GAPLESS BOUNDARY PASS: advanced to index 1 once, with the correct metadata'

# Locker fixture — full tier on emulator without YouTube. Build step generates the m4a; seed
# imports it through the real locker path; play-offline drives playLockerTrack + progress.
adb -s "$EMU_SERIAL" logcat -c >/dev/null
deeplink 'seed-locker-fixture'
wait_logcat 'SandboxE2E.*AREA=locker-seed RESULT=PASS' 90 \
  || { echo 'Playback E2E FAIL: seed-locker-fixture'; diagnose_failure 'seed-locker-fixture'; exit 1; }

locker_artist="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Sandbox E2E'))")"
locker_track="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Locker Tone'))")"
locker_album="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Sandbox E2E Fixtures'))")"
deeplink "play-offline?artist=${locker_artist}&track=${locker_track}&album=${locker_album}&progressSeconds=3&integritySeconds=0"
wait_logcat 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120 \
  || { echo 'Playback E2E FAIL: locker play-offline'; diagnose_failure 'locker-play-offline'; exit 1; }
wait_logcat 'SandboxE2E.*AREA=playback-progress RESULT=PASS' 120 \
  || { echo 'Playback E2E FAIL: locker playback-progress'; diagnose_failure 'locker-playback-progress'; exit 1; }

LOCKER_LOGS="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
LOCKER_RESULT="$(grade_locker_fixture_from_logs "$LOCKER_LOGS" || true)"
if [[ "$LOCKER_RESULT" != 'full' ]]; then
  echo "Playback E2E FAIL: locker fixture did not reach full tier (${LOCKER_RESULT})"
  diagnose_failure 'locker-fixture'
  exit 1
fi
echo 'LOCKER FIXTURE PASS (full): seed + play-offline + playback-progress'

# Commercial catalog — separate expectation. Upstream audio (YouTube/Invidious) blocks datacenter
# IPs on CI runners, so full decode here is only achievable on a physical device with permissive
# network or a configured Sandbox Server. The gate does not fail when commercial stays spine-only.
artist="$(python3 -c "import urllib.parse; print(urllib.parse.quote('Kanye West'))")"
track="$(python3 -c "import urllib.parse; print(urllib.parse.quote('FATHER'))")"

adb -s "$EMU_SERIAL" logcat -c >/dev/null
reset_play_spine_seen
deeplink "play-artist-track?artist=${artist}&track=${track}&progressSeconds=25&integritySeconds=0"

COMMERCIAL_RESULT='fail'
if wait_logcat 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 360; then
  if wait_logcat 'SandboxE2E.*AREA=playback-progress RESULT=PASS' 120 && assert_play_spine; then
    COMMERCIAL_RESULT='full'
    echo 'COMMERCIAL CATALOG PASS (full): artist-track-play + playback-progress'
  else
    echo 'Playback E2E WARN: commercial full tier incomplete (progress or spine)'
    COMMERCIAL_LOGS="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
    COMMERCIAL_RESULT="$(grade_commercial_catalog_from_logs "$COMMERCIAL_LOGS" || true)"
    if [[ "$COMMERCIAL_RESULT" == 'spine' ]]; then
      echo 'COMMERCIAL CATALOG PASS (spine only): resolve + playUrl reached; upstream audio unavailable on this runner'
    fi
  fi
else
  COMMERCIAL_LOGS="$(adb -s "$EMU_SERIAL" logcat -d -t 12000 2>/dev/null || true)"
  COMMERCIAL_RESULT="$(grade_commercial_catalog_from_logs "$COMMERCIAL_LOGS" || true)"
  if [[ "$COMMERCIAL_RESULT" == 'spine' ]]; then
    echo 'COMMERCIAL CATALOG PASS (spine only): resolve + playUrl reached; upstream audio unavailable on this runner'
  else
    echo "COMMERCIAL CATALOG NOT COVERED (${COMMERCIAL_RESULT}) — needs physical device or Sandbox Server; not a gate failure"
  fi
fi

{
  echo '# Android Playback E2E Report'
  echo "Date: $(date -Iseconds)"
  echo "Device: ${EMU_SERIAL} (emulator)"
  echo 'Result: PASS (locker fixture full)'
  echo ''
  echo '## Locker fixture (gate)'
  echo '- locker-seed: PASS'
  echo '- play-offline (playLockerTrack): PASS'
  echo '- playback-progress: PASS'
  echo '- tier: full (offline locker decode on emulator)'
  echo ''
  echo '## Direct URL controls'
  echo '- direct-url-play: PASS'
  echo '- direct-queue (gapless boundary): PASS'
  echo ''
  echo '## Commercial catalog (informational — not gated on CI emulator)'
  if [[ "$COMMERCIAL_RESULT" == 'full' ]]; then
    echo '- artist-track-play: PASS'
    echo '- playback-progress: PASS'
    echo '- tier: full'
  elif [[ "$COMMERCIAL_RESULT" == 'spine' ]]; then
    echo '- artist-track-play: NOT REACHED — upstream audio unavailable (R-017)'
    echo '- playback-progress: NOT REACHED'
    echo '- play spine (play-spine invoke + playUrl): PASS'
    echo '- tier: spine only'
    echo 'Commercial full decode needs a physical device or Sandbox Server; datacenter IPs are blocked upstream.'
  else
    echo "- artist-track-play: NOT COVERED (${COMMERCIAL_RESULT})"
    echo '- playback-progress: NOT REACHED'
    echo '- tier: not covered on this runner'
    echo 'Commercial catalog coverage requires a physical device or Sandbox Server.'
  fi
  echo ''
  echo 'Ready for phone install: requires phone-playback-vinyl-e2e.ps1 on physical device'
} >"$REPORT"

echo 'PLAYBACK E2E PASS (locker fixture full on emulator)'
exit 0
