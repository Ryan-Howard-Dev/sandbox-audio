# Verify five bottom nav tabs via uiautomator on a connected Android device.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
# aria-label uses full nav labels; Podcasts tab stays visible when addon is off.
$ExpectedContentDesc = @('Home', 'Library', 'Search', 'Podcasts', 'Menu')

$lines = & adb devices 2>&1
$serial = $lines | Where-Object { $_ -match '\tdevice$' } | ForEach-Object { ($_ -split '\t')[0] } | Select-Object -First 1
if (-not $serial) {
    Write-Host 'No adb device connected — skipping install/verify'
    exit 0
}

Write-Host "Device: $serial"
$apk = Get-ChildItem -Path 'android\app\build\outputs\apk\debug' -Filter '*.apk' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $apk) { throw 'Debug APK not found — run npm run build:android:apk first' }

& adb -s $serial install -r $apk.FullName | Out-Null
& adb -s $serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& adb -s $serial shell input keyevent KEYCODE_WAKEUP | Out-Null
& adb -s $serial shell wm dismiss-keyguard 2>$null | Out-Null
& adb -s $serial shell input keyevent 82 2>$null | Out-Null
Start-Sleep -Seconds 1
& adb -s $serial shell am start -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 16

& adb -s $serial shell uiautomator dump /sdcard/window_dump.xml | Out-Null
$xml = & adb -s $serial shell cat /sdcard/window_dump.xml

$found = 0
foreach ($label in $ExpectedContentDesc) {
    if ($xml -match "content-desc=`"$label") {
        Write-Host "FOUND content-desc: $label"
        $found++
    } elseif ($label -eq 'Menu' -and $xml -match 'content-desc="Menu') {
        Write-Host 'FOUND content-desc: Menu (with badge)'
        $found++
    } else {
        Write-Host "MISSING content-desc: $label" -ForegroundColor Red
    }
}

Write-Host "bottom-nav matches: $found / $($ExpectedContentDesc.Count)"
if ($found -ne 5) {
    throw "Expected 5 bottom nav tabs, found $found"
}

$vc = & adb -s $serial shell dumpsys package $Package | Select-String 'versionCode=' | Select-Object -First 1
Write-Host "Package: $vc"
Write-Host 'PASS: five bottom nav tabs present' -ForegroundColor Green
