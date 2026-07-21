# Quick physical-device launch smoke — no E2E deep links (production bundle).
$ErrorActionPreference = 'Stop'
$Serial = '46349770'
$Package = 'rd.sheepskin.sandboxmusic'
. "$PSScriptRoot\set-android-env.ps1"

adb -s $Serial logcat -c | Out-Null
adb -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
adb -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null
Write-Host "Launched on $Serial - waiting 15s..."
Start-Sleep -Seconds 15

$log = adb -s $Serial logcat -d -t 500 2>$null
$fatal = $log | Select-String -Pattern 'FATAL EXCEPTION|AndroidRuntime.*FATAL'
if ($fatal) {
    Write-Host 'FAIL: crash detected' -ForegroundColor Red
    $fatal | Select-Object -First 8
    exit 1
}

$running = adb -s $Serial shell pidof $Package 2>$null
if (-not $running) {
    Write-Host 'FAIL: app process not running after launch' -ForegroundColor Red
    exit 1
}

Write-Host "PASS: app running (pid $running), no fatal crash" -ForegroundColor Green
$log | Select-String -Pattern 'BUILD_ID|Capacitor/Console.*Error|locker|queue restore' | Select-Object -First 12
exit 0
