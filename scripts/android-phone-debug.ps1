# Sandbox Music - physical Android phone debug (USB / adb)
# Usage:
#   1. Enable Developer options + USB debugging on the phone
#   2. Connect via USB, accept the RSA fingerprint prompt
#   3. .\scripts\android-phone-debug.ps1
# Optional: .\scripts\android-phone-debug.ps1 -SkipBuild -Query "Bohemian Rhapsody"

param(
    [string]$DeviceSerial = '',
    [string]$Query = 'Shake It Off',
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$OfflineOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$LogcatFile = Join-Path $Root '.phone-debug-logcat.txt'
$LogTags = 'Capacitor/Console:I,YtDlpMobile:I,NativeExoPlayback:I,SandboxE2E:I'

function Write-AreaResult {
    param(
        [string]$Area,
        [bool]$Pass,
        [string]$Detail = ''
    )
    $status = if ($Pass) { 'PASS' } else { 'FAIL' }
    $line = "[$status] $Area"
    if ($Detail) { $line += " - $Detail" }
    if ($Pass) { Write-Host $line -ForegroundColor Green }
    else { Write-Host $line -ForegroundColor Red }
    return $Pass
}

function Get-PhoneSerial {
    if ($DeviceSerial) { return $DeviceSerial.Trim() }
    $lines = & adb.exe devices 2>$null
    foreach ($line in $lines) {
        if ($line -match '^([^\s]+)\s+device$' -and $Matches[1] -notmatch '^emulator-') {
            return $Matches[1]
        }
    }
    return $null
}

function Invoke-Adb {
    param([string[]]$Command)
    if (-not $Command -or $Command.Count -eq 0) {
        throw 'Invoke-Adb requires at least one argument'
    }
    $serial = $script:PhoneSerial
    Assert-NotUserDeviceDestructiveAdb -Serial $serial -Command $Command
    if ($serial) { & adb.exe -s $serial @Command } else { & adb.exe @Command }
    if ($LASTEXITCODE -ne 0) {
        throw ("adb failed: adb.exe " + ($Command -join ' '))
    }
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    Invoke-Adb -Command @('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', $uri, $Package)
}

function Wait-LogcatMatch {
    param(
        [string]$Pattern,
        [int]$TimeoutSec = 120
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = & adb.exe -s $script:PhoneSerial logcat -d -t 8000 2>$null
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Build-Arm64Apk {
    Write-Host 'Building arm64-v8a debug APK ...'
    npm run build:android:apk
    if (-not (Test-Path (Join-Path $Root $ApkRel))) {
        throw "APK not found at $ApkRel - connect phone or run gradlew assembleDebug manually"
    }
}

$script:PhoneSerial = Get-PhoneSerial
if (-not $script:PhoneSerial) {
    Write-Host ''
    Write-Host 'No USB device found.' -ForegroundColor Yellow
    Write-Host 'On your OnePlus 12:'
    Write-Host '  Settings -> About phone -> tap Build number 7x -> Developer options'
    Write-Host '  Enable USB debugging, connect USB, accept RSA fingerprint'
    Write-Host 'Then run: adb devices'
    Write-Host ''
    & adb.exe devices
    exit 1
}

Write-Host "Using device: $script:PhoneSerial" -ForegroundColor Cyan
$abi = (Invoke-Adb -Command @('shell', 'getprop', 'ro.product.cpu.abi')).Trim()
Write-Host "Device ABI: $abi"

$results = @{}

try {
    if (-not $SkipBuild) {
        Build-Arm64Apk
    }
    $apkPath = Join-Path $Root $ApkRel
    if (-not (Test-Path $apkPath)) {
        throw "APK missing: $apkPath (run without -SkipBuild)"
    }
    $results['APK present'] = Write-AreaResult 'APK present' $true $apkPath

    if (-not $SkipInstall) {
        Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
        $results['APK install'] = Write-AreaResult 'APK install' $true $apkPath
    }

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 1
    Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
    Start-Sleep -Seconds 5
    $launchLog = & adb.exe -s $script:PhoneSerial logcat -d -t 200 2>$null
    $launchOk = -not ($launchLog -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic')
    $results['App launch'] = Write-AreaResult 'App launch' $launchOk 'no FATAL on launch'

    Invoke-DeepLink 'skip-onboarding'
    Start-Sleep -Seconds 2
    $onboardingOk = Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' -TimeoutSec 20
    $results['Onboarding'] = Write-AreaResult 'Onboarding' $onboardingOk 'skip-onboarding'

    Invoke-DeepLink 'check-ytdlp'
    Start-Sleep -Seconds 5
    $ytdlpE2eOk = Wait-LogcatMatch 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' -TimeoutSec 120
    $ytdlpInitOk = Wait-LogcatMatch 'youtubedl-android initialized|YtDlpMobile.*initialized' -TimeoutSec 90
    $ytdlpOk = $ytdlpE2eOk -or $ytdlpInitOk
    $results['yt-dlp mobile'] = Write-AreaResult 'yt-dlp mobile' $ytdlpOk "e2e=$ytdlpE2eOk init=$ytdlpInitOk"

    if ($OfflineOnly) {
        Invoke-DeepLink 'clear-server'
        Start-Sleep -Seconds 2
    }

    $encodedQuery = [uri]::EscapeDataString($Query)
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "mobile-play?query=$encodedQuery"
    $resolveOk = Wait-LogcatMatch 'YtDlpMobile.*resolve ok|\[YtDlpMobile\] resolve ok' -TimeoutSec 150
    $playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=mobile-play RESULT=PASS' -TimeoutSec 150
    $exoOk = Wait-LogcatMatch 'NativeExoPlayback.*playing|SandboxE2E.*AREA=exo-status RESULT=PASS' -TimeoutSec 60
    $results['Mobile play'] = Write-AreaResult 'Mobile play' ($playOk -and $resolveOk) "query=$Query resolve=$resolveOk play=$playOk exo=$exoOk"

    Invoke-DeepLink 'check-exo'
    $exoCheckOk = Wait-LogcatMatch 'SandboxE2E.*AREA=exo-status RESULT=PASS' -TimeoutSec 45
    $results['ExoPlayer status'] = Write-AreaResult 'ExoPlayer status' ($exoCheckOk -or $playOk) "check=$exoCheckOk"

    & adb.exe -s $script:PhoneSerial logcat -d -s $LogTags > $LogcatFile 2>$null
    if (-not (Test-Path $LogcatFile) -or (Get-Item $LogcatFile).Length -lt 64) {
        & adb.exe -s $script:PhoneSerial logcat -d -t 12000 > $LogcatFile
    }
    $logText = Get-Content $LogcatFile -Raw
    $noFatal = -not ($logText -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic')
    $results['Logcat / crashes'] = Write-AreaResult 'Logcat / crashes' $noFatal $LogcatFile

    Write-Host ''
    Write-Host '=== PHONE DEBUG SUMMARY ===' -ForegroundColor Cyan
    $allPass = $true
    foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
        $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
        Write-Host "$mark  $($kv.Key)"
        if (-not $kv.Value) { $allPass = $false }
    }

    if (-not $allPass) {
        Write-Host ''
        Write-Host "Logcat saved to $LogcatFile" -ForegroundColor Yellow
        Write-Host "Filter live: adb -s $script:PhoneSerial logcat -s $LogTags" -ForegroundColor Yellow
        exit 1
    }

    Write-Host ''
    Write-Host "All checks PASS. APK: $apkPath" -ForegroundColor Green
    Write-Host "Live logcat: adb -s $script:PhoneSerial logcat -s $LogTags" -ForegroundColor Green
    exit 0
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:PhoneSerial) {
        & adb.exe -s $script:PhoneSerial logcat -d -t 4000 > $LogcatFile 2>$null
        Write-Host "Partial logcat: $LogcatFile" -ForegroundColor Yellow
    }
    exit 1
}
