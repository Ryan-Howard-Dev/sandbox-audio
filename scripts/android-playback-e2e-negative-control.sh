#!/usr/bin/env bash
# Negative-control harness for android-playback-e2e grading functions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=android-playback-e2e.sh
source "$ROOT/scripts/android-playback-e2e-grading.sh"

printf "%-32s %-24s %-24s %s\n" "Scenario" "Expected" "Actual" "Verdict"
printf "%-32s %-24s %-24s %s\n" "--------" "--------" "------" "-------"

check_locker() {
  local name="$1" logs="$2" expect="$3"
  local actual
  actual="$(grade_locker_fixture_from_logs "$logs" 2>/dev/null || true)"
  local verdict="REJECT"
  [[ "$actual" == "$expect" ]] && verdict="OK"
  printf "%-32s %-24s %-24s %s\n" "$name" "$expect" "$actual" "$verdict"
}

check_commercial() {
  local name="$1" logs="$2" expect="$3"
  local actual
  actual="$(grade_commercial_catalog_from_logs "$logs" 2>/dev/null || true)"
  local verdict="REJECT"
  [[ "$actual" == "$expect" ]] && verdict="OK"
  printf "%-32s %-24s %-24s %s\n" "$name" "$expect" "$actual" "$verdict"
}

check_locker "empty logcat" "" "fail:locker-seed-missing"
check_locker "seed fails" $'SandboxE2E AREA=locker-seed RESULT=FAIL\nSandboxE2E AREA=play-offline RESULT=PASS' "fail:locker-seed-missing"
check_locker "locker missing (play-offline fail)" $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=FAIL' "fail:play-offline-missing"
check_locker "no progress" $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=PASS' "fail:playback-progress-missing"
check_locker "full happy path" $'SandboxE2E AREA=locker-seed RESULT=PASS\nSandboxE2E AREA=play-offline RESULT=PASS\nSandboxE2E AREA=playback-progress RESULT=PASS advance=3.0s' "full"

check_commercial "handler not invoked" "" "fail:handler-not-invoked"
check_commercial "spine only (upstream blocked)" $'SandboxE2E AREA=play-spine invoke\nSandboxE2E AREA=play-spine returned true\nmethodName: playUrl\nReceived HTML instead of audio' "spine"
