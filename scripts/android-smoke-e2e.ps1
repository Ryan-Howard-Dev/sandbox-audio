# Minimal Android smoke E2E — bootstrap + one playback probe (emulator only).
param(
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$EmuSerial = 'emulator-5554'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'

function Invoke-DeepLink {
    param([string]$Path)
    Start-E2eDeepLink -Path $Path
    Start-Sleep -Seconds 2
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 120)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = & adb.exe -s $EmuSerial logcat -d -s 'Capacitor/Console:*' -t 8000 2>$null
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

if (-not $SkipBuild) {
    Write-Host 'Building x86_64 debug APK...'
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }

& adb.exe -s $EmuSerial install -r $apk | Out-Null
& adb.exe -s $EmuSerial logcat -c | Out-Null
& adb.exe -s $EmuSerial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2

Start-E2eDeepLink -Path 'skip-onboarding'
Start-Sleep -Seconds 15
if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' -TimeoutSec 90)) {
    throw 'Smoke FAIL: skip-onboarding'
}

Invoke-DeepLink 'clear-server'
Invoke-DeepLink 'check-ytdlp'
Start-Sleep -Seconds 6

$artist = [uri]::EscapeDataString('Kanye West')
$track = [uri]::EscapeDataString('FATHER')
Invoke-DeepLink "play-artist-track?artist=$artist&track=$track"
if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 240)) {
    throw 'Smoke FAIL: play-artist-track'
}

Write-Host 'SMOKE PASS: bootstrap + artist-track-play' -ForegroundColor Green
exit 0
