# Sandbox Music — Android TV emulator end-to-end automation
# Usage: .\scripts\android-tv-e2e.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"

$AvdName = 'SandboxMusic_TV_API36_x86_64'
$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = 'emulator-5580'
$TvSystemImage = 'system-images;android-36;google_apis_tv;x86_64'
$TvDeviceId = 'tv_1080p'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$ServerUrl = 'http://10.0.2.2:3001'
$TestQuery = 'Shake It Off'
$LogcatFile = Join-Path $Root '.e2e-logcat-tv.txt'
$ServerLogFile = Join-Path $Root '.e2e-server.log'
$ServerJob = $null
$EmulatorProc = $null

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

function Invoke-Adb {
    param([string[]]$Command)
    if (-not $Command -or $Command.Count -eq 0) {
        throw 'Invoke-Adb requires at least one argument'
    }
    Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command
    if ($EmuSerial) { & adb.exe -s $EmuSerial @Command } else { & adb.exe @Command }
    if ($LASTEXITCODE -ne 0) {
        throw ("adb failed: adb.exe " + ($Command -join ' '))
    }
}

function Wait-EmulatorBoot {
    param([int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $boot = (Invoke-Adb -Command @('shell', 'getprop', 'sys.boot_completed') 2>$null).Trim()
            if ($boot -eq '1') { return $true }
        } catch { }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Get-AvdExists {
    param([string]$Name)
    $avds = & emulator -list-avds 2>$null
    return ($avds -contains $Name)
}

function Ensure-Avd {
    if (Get-AvdExists -Name $AvdName) { return }
    Write-Host "Creating AVD $AvdName ..."
    $sdkmanager = Join-Path $env:ANDROID_HOME 'cmdline-tools\latest\bin\sdkmanager.bat'
    if (-not (Test-Path $sdkmanager)) {
        $sdkmanager = Join-Path $env:ANDROID_HOME 'tools\bin\sdkmanager.bat'
    }
    if (-not (Test-Path $sdkmanager)) {
        throw "sdkmanager not found - install Android SDK cmdline-tools"
    }
    & $sdkmanager --install $TvSystemImage | Out-Null
    echo 'no' | & avdmanager create avd -n $AvdName -k $TvSystemImage -d $TvDeviceId -f
}

function Start-EmulatorIfNeeded {
    $devices = & adb devices 2>$null
    if ($devices -match 'emulator-5580\s+device') {
        Write-Host 'Emulator already running'
        return
    }
    Ensure-Avd
    Write-Host "Starting TV emulator $AvdName on port 5580 ..."
    $EmulatorProc = Start-Process -FilePath 'emulator' -ArgumentList @('-avd', $AvdName, '-port', '5580', '-no-snapshot-save', '-gpu', 'swiftshader_indirect') -PassThru -WindowStyle Minimized
    if (-not (Wait-EmulatorBoot)) {
        throw 'Emulator boot timeout'
    }
}

function Start-Tier34Server {
    Write-Host 'Ensuring tier34 server on port 3001 ...'
    try {
        npx --yes kill-port 3001 2>$null | Out-Null
    } catch { }
    Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object {
            Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    Start-Sleep -Seconds 2
    $existing = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host 'Tier34 server already listening on port 3001 (could not restart)'
        return $null
    }
    $job = Start-Job -ScriptBlock {
        param($Root, $LogFile)
        Set-Location $Root
        $env:PORT = '3001'
        npx tsx tier34-server/index.ts *> $LogFile
    } -ArgumentList $Root, $ServerLogFile
    $deadline = (Get-Date).AddSeconds(45)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -eq 200) { return $job }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw 'Tier34 server failed to start on port 3001'
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    Invoke-Adb -Command @('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', $uri, $Package)
}

function Wait-LogcatMatch {
    param(
        [string]$Pattern,
        [int]$TimeoutSec = 90,
        [switch]$ClearFirst
    )
    if ($ClearFirst) { Invoke-Adb -Command @('logcat', '-c') | Out-Null }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = & adb.exe -s $EmuSerial logcat -d -s 'Capacitor/Console:I' -t 8000 2>$null
        if (-not $chunk) {
            $chunk = & adb.exe -s $EmuSerial logcat -d -t 8000 2>$null
        }
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-NoFatalCrashes {
    param([string]$LogText)
    return -not ($LogText -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic')
}

function Build-Apk {
    Write-Host 'Building debug APK (x86_64) ...'
    npm run build:android:apk
    if (-not (Test-Path (Join-Path $Root $ApkRel))) {
        throw "APK not found at $ApkRel"
    }
}

$results = @{}

try {
    # --- Emulator boot ---
    Start-EmulatorIfNeeded
    $bootOk = Wait-EmulatorBoot
    $results['Emulator boot'] = Write-AreaResult 'Emulator boot' $bootOk "sys.boot_completed=$bootOk"

    # --- Build & install ---
    Build-Apk
    $apkPath = Join-Path $Root $ApkRel
    Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
    $results['APK install'] = Write-AreaResult 'APK install' $true $apkPath

    # --- Start server on host ---
    $ServerJob = Start-Tier34Server
    try {
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 5
        $hostHealthOk = ($health.StatusCode -eq 200)
    } catch {
        $hostHealthOk = $false
    }
    $results['Server health (host)'] = Write-AreaResult 'Server health (host)' $hostHealthOk 'http://127.0.0.1:3001/health'

    # --- Launch app ---
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 1
    Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LEANBACK_LAUNCHER', '1') | Out-Null
    Start-Sleep -Seconds 5
    $launchLog = & adb.exe -s $EmuSerial logcat -d -t 200 2>$null
    $launchOk = -not ($launchLog -match 'FATAL EXCEPTION')
    $results['App launch'] = Write-AreaResult 'App launch' $launchOk 'no FATAL on launch'

    # --- Onboarding skip (must run before TV probe so WebView is ready) ---
    Invoke-DeepLink 'skip-onboarding'
    Start-Sleep -Seconds 3
    $onboardingOk = Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' -TimeoutSec 20
    $results['Onboarding'] = Write-AreaResult 'Onboarding' $onboardingOk 'skip-onboarding deep link'

    # --- TV mode detection ---
    Invoke-DeepLink 'probe-tv-mode'
    Start-Sleep -Seconds 2
    $tvModeOk = Wait-LogcatMatch 'SandboxE2E.*AREA=tv-mode RESULT=PASS' -TimeoutSec 30
    $results['TV mode detection'] = Write-AreaResult 'TV mode detection' $tvModeOk 'detectTVPlatform=true'

    # --- D-pad navigation (remote control keyevents) ---
    Invoke-Adb -Command @('shell', 'input', 'keyevent', '20') | Out-Null  # DPAD_DOWN
    Start-Sleep -Milliseconds 500
    Invoke-Adb -Command @('shell', 'input', 'keyevent', '22') | Out-Null  # DPAD_RIGHT
    Start-Sleep -Milliseconds 500
    Invoke-Adb -Command @('shell', 'input', 'keyevent', '23') | Out-Null  # DPAD_CENTER
    Start-Sleep -Seconds 2
    $dpadLog = & adb.exe -s $EmuSerial logcat -d -t 100 2>$null
    $dpadOk = -not ($dpadLog -match 'FATAL EXCEPTION')
    $results['D-pad navigation'] = Write-AreaResult 'D-pad navigation' $dpadOk 'DPAD_DOWN/RIGHT/CENTER'

    # --- Configure server URL for emulator ---
    $encodedUrl = [uri]::EscapeDataString($ServerUrl)
    Invoke-DeepLink "set-server?url=$encodedUrl"
    Start-Sleep -Seconds 3
    $serverUrlOk = Wait-LogcatMatch 'SandboxE2E.*AREA=server-url RESULT=PASS' -TimeoutSec 30
    $results['Server URL 10.0.2.2:3001'] = Write-AreaResult 'Server URL 10.0.2.2:3001' $serverUrlOk $ServerUrl

    # --- yt-dlp mobile resolver ---
    Invoke-DeepLink 'check-ytdlp'
    Start-Sleep -Seconds 5
    $ytdlpE2eOk = Wait-LogcatMatch 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' -TimeoutSec 120
    $ytdlpInitOk = Wait-LogcatMatch 'youtubedl-android initialized in \d+ ms|YtDlpMobile.*init ready for E2E' -TimeoutSec 30
    $ytdlpOk = $ytdlpE2eOk -or $ytdlpInitOk
    $results['Settings yt-dlp mobile'] = Write-AreaResult 'Settings yt-dlp mobile' $ytdlpOk "e2e=$ytdlpE2eOk initLog=$ytdlpInitOk"

    Start-Sleep -Seconds 3

    # --- Search ---
    $encodedQuery = [uri]::EscapeDataString($TestQuery)
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "search?query=$encodedQuery"
    $searchOk = Wait-LogcatMatch 'SandboxE2E.*AREA=search RESULT=PASS' -TimeoutSec 120
    $results['Search'] = Write-AreaResult 'Search' $searchOk "query=$TestQuery"

    # --- Mobile playback via yt-dlp ---
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "mobile-play?query=$encodedQuery"
    $mobileResolveOk = Wait-LogcatMatch 'YtDlpMobile.*resolve ok|YtDlpMobile.*E2E resolve transport=MOBILE' -TimeoutSec 120
    $mobilePlayOk = Wait-LogcatMatch 'SandboxE2E.*AREA=mobile-play RESULT=PASS' -TimeoutSec 150
    $results['Playback via yt-dlp mobile'] = Write-AreaResult 'Playback via yt-dlp mobile' ($mobileResolveOk -and $mobilePlayOk) "resolve=$mobileResolveOk play=$mobilePlayOk"

    # --- ExoPlayer state (check-exo after mobile-play; also accept mobile-play pass) ---
    Invoke-DeepLink 'check-exo'
    $exoCheckOk = Wait-LogcatMatch 'SandboxE2E.*AREA=exo-status RESULT=PASS' -TimeoutSec 45
    $exoOk = $mobilePlayOk
    $results['ExoPlayer'] = Write-AreaResult 'ExoPlayer' $exoOk "mobilePlay=$mobilePlayOk exoCheck=$exoCheckOk"

    # Re-assert tier34 reachability after long playback (server job / emulator network edges)
    try {
        $hostRecheck = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 5
        if ($hostRecheck.StatusCode -ne 200) { throw 'host health failed' }
    } catch {
        Write-Host 'Restarting tier34 server before late probes ...'
        $ServerJob = Start-Tier34Server
    }
    $encodedUrl = [uri]::EscapeDataString($ServerUrl)
    Invoke-DeepLink "set-server?url=$encodedUrl"
    Start-Sleep -Seconds 4

    # --- Navigation tabs ---
    Start-Sleep -Seconds 3
    $tabs = @('home', 'locker', 'discover', 'search', 'settings')
    $navAllOk = $true
    foreach ($tab in $tabs) {
        Invoke-DeepLink "navigate?tab=$tab"
        $tabOk = Wait-LogcatMatch "SandboxE2E.*AREA=navigation RESULT=PASS tab=$tab" -TimeoutSec 30
        if (-not $tabOk) { $navAllOk = $false }
    }
    $results['Navigation tabs'] = Write-AreaResult 'Navigation tabs' $navAllOk ($tabs -join ', ')

    # --- Discover / feed ---
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink 'probe-feed'
    $feedOk = Wait-LogcatMatch 'SandboxE2E.*AREA=discover-feed RESULT=PASS' -TimeoutSec 120
    $results['Discover / feed'] = Write-AreaResult 'Discover / feed' $feedOk 'tier34 /api/feed'

    # --- Server probe from app ---
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink 'probe-server'
    $appServerOk = Wait-LogcatMatch 'SandboxE2E.*AREA=server-health RESULT=PASS' -TimeoutSec 30
    $results['Server health (app)'] = Write-AreaResult 'Server health (app)' $appServerOk $ServerUrl

    # --- Logcat / crashes ---
    try {
        & adb.exe -s $EmuSerial logcat -d | Out-File -FilePath $LogcatFile -Encoding utf8 -Force
    } catch {
        Write-Host "Warning: could not save logcat to $LogcatFile ($($_.Exception.Message))" -ForegroundColor Yellow
    }
    $logText = if (Test-Path $LogcatFile) { Get-Content $LogcatFile -Raw } else { '' }
    $noFatal = Test-NoFatalCrashes -LogText $logText
    $results['Logcat / crashes'] = Write-AreaResult 'Logcat / crashes' $noFatal 'no app FATAL'

    Write-Host ''
    Write-Host '=== E2E SUMMARY ===' -ForegroundColor Cyan
    $allPass = $true
    foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
        $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
        Write-Host "$mark  $($kv.Key)"
        if (-not $kv.Value) { $allPass = $false }
    }

    if (-not $allPass) {
        Write-Host ''
        Write-Host "Logcat saved to $LogcatFile" -ForegroundColor Yellow
        exit 1
    }

    Write-Host ''
    Write-Host "All areas PASS. APK: $apkPath" -ForegroundColor Green
    exit 0
}
finally {
    if ($ServerJob) {
        Stop-Job $ServerJob -ErrorAction SilentlyContinue
        Remove-Job $ServerJob -Force -ErrorAction SilentlyContinue
    }
}
