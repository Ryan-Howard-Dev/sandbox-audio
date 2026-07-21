$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
adb kill-server 2>$null | Out-Null
Start-Sleep -Seconds 2
adb start-server 2>$null | Out-Null
Push-Location (Join-Path $Root 'android')
& .\gradlew.bat clean assembleDebug
Pop-Location
$apk = Join-Path $Root 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }
adb -s emulator-5554 install -r $apk
