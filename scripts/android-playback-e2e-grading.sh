#!/usr/bin/env bash
# Grading helpers for android-playback-e2e (sourced by gate + negative-control harness).

upstream_stream_unavailable_from_logs() {
  local logs="$1"
  grep -Eq 'Received HTML instead of audio|no stream available|is not valid JSON' <<<"$logs"
}

assert_play_spine_reached_from_logs() {
  local logs="$1"
  grep -Eq 'SandboxE2E.*AREA=play-spine.*invoke' <<<"$logs" \
    || { echo 'spine: play-artist-track never invoked the play handler'; return 1; }
  grep -Eq 'SandboxE2E.*AREA=play-spine.*returned true' <<<"$logs" \
    || { echo 'spine: play handler did not resolve a playable envelope'; return 1; }
  grep -Fq 'methodName: playUrl' <<<"$logs" \
    || { echo 'spine: NativeExoPlayback.playUrl was never called'; return 1; }
  return 0
}

# Returns 0 and prints "full" when locker fixture reached decode + progress.
grade_locker_fixture_from_logs() {
  local logs="$1"
  if ! grep -Eq 'SandboxE2E.*AREA=locker-seed RESULT=PASS' <<<"$logs"; then
    echo 'fail:locker-seed-missing'
    return 1
  fi
  if ! grep -Eq 'SandboxE2E.*AREA=play-offline RESULT=PASS' <<<"$logs"; then
    echo 'fail:play-offline-missing'
    return 1
  fi
  if ! grep -Eq 'SandboxE2E.*AREA=playback-progress RESULT=PASS' <<<"$logs"; then
    echo 'fail:playback-progress-missing'
    return 1
  fi
  echo 'full'
  return 0
}

# Commercial catalog: full decode, spine-only (upstream blocked), or fail.
grade_commercial_catalog_from_logs() {
  local logs="$1"
  if grep -Eq 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' <<<"$logs"; then
    echo 'full'
    return 0
  fi
  if upstream_stream_unavailable_from_logs "$logs" && assert_play_spine_reached_from_logs "$logs" >/dev/null; then
    echo 'spine'
    return 0
  fi
  if ! grep -Eq 'SandboxE2E.*AREA=play-spine.*invoke' <<<"$logs"; then
    echo 'fail:handler-not-invoked'
    return 1
  fi
  echo 'fail:upstream-or-spine'
  return 1
}

run_negative_control_self_test() {
  local pass=0 fail=0
  local result

  result="$(grade_locker_fixture_from_logs '' 2>/dev/null || true)"
  [[ "$result" == fail:* ]] && ((pass++)) || ((fail++))

  result="$(grade_locker_fixture_from_logs $'SandboxE2E AREA=locker-seed RESULT=PASS entryId=x' 2>/dev/null || true)"
  [[ "$result" == fail:* ]] && ((pass++)) || ((fail++))

  result="$(grade_locker_fixture_from_logs $'SandboxE2E AREA=locker-seed RESULT=FAIL\nSandboxE2E AREA=play-offline RESULT=PASS' 2>/dev/null || true)"
  [[ "$result" == fail:locker-seed-missing ]] && ((pass++)) || ((fail++))

  result="$(grade_locker_fixture_from_logs $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=FAIL' 2>/dev/null || true)"
  [[ "$result" == fail:play-offline-missing ]] && ((pass++)) || ((fail++))

  result="$(grade_locker_fixture_from_logs $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=PASS' 2>/dev/null || true)"
  [[ "$result" == fail:playback-progress-missing ]] && ((pass++)) || ((fail++))

  result="$(grade_locker_fixture_from_logs $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=PASS\nSandboxE2E AREA=playback-progress RESULT=PASS advance=3.0s' 2>/dev/null || true)"
  [[ "$result" == full ]] && ((pass++)) || ((fail++))

  echo "negative-control-self-test: ${pass} passed / $((pass + fail)) cases"
  [[ "$fail" -eq 0 ]]
}
