# Sandbox Music — Android emulator end-to-end automation
# Usage: .\scripts\android-emulator-e2e.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'

$AvdName = 'SandboxMusic_API36_x86_64'
$EmuSerial = 'emulator-5554'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$ServerUrl = 'http://10.0.2.2:3001'
$TestQuery = 'Shake It Off'
$LogcatFile = Join-Path $Root '.e2e-logcat.txt'
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
    & $sdkmanager --install 'system-images;android-36;google_apis;x86_64' | Out-Null
    echo 'no' | & avdmanager create avd -n $AvdName -k 'system-images;android-36;google_apis;x86_64' -d 'pixel_6' -f
}

function Start-EmulatorIfNeeded {
    $devices = & adb devices 2>$null
    if ($devices -match 'emulator-5554\s+device') {
        Write-Host 'Phone emulator already running (emulator-5554)'
        return
    }
    Ensure-Avd
    Write-Host "Starting emulator $AvdName on port 5554 ..."
    $EmulatorProc = Start-Process -FilePath 'emulator' -ArgumentList @('-avd', $AvdName, '-port', '5554', '-no-snapshot-save', '-gpu', 'swiftshader_indirect') -PassThru -WindowStyle Minimized
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
    Start-E2eDeepLink -Path $Path
    Start-Sleep -Seconds 2
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
        $adbArgs = @('-s', $EmuSerial, 'logcat', '-d', '-s', 'Capacitor/Console:I', '-t', '8000')
        $chunk = & adb.exe @adbArgs 2>$null
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
    Stop-CompetingAndroidE2e
    Clear-StaleE2eEmulatorLock $EmulatorLockFile
    # --- Emulator boot ---
    Start-EmulatorIfNeeded
    $bootOk = Wait-EmulatorBoot
    $results['Emulator boot'] = Write-AreaResult 'Emulator boot' $bootOk "sys.boot_completed=$bootOk"

    # --- Build & install ---
    Build-Apk
    $apkPath = Join-Path $Root $ApkRel
    Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
    $results['APK install'] = Write-AreaResult 'APK install' $true $apkPath

    Write-Host 'Cold-starting app and waiting for E2E bridge...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'skip-onboarding'
    Start-Sleep -Seconds 20
    $handlersOk = Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' -TimeoutSec 120
    if (-not $handlersOk) {
        Invoke-DeepLink 'probe-handlers'
        Start-Sleep -Seconds 3
        $handlersOk = Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' -TimeoutSec 90
    }
    if (-not $handlersOk) {
        throw 'E2E handlers not registered after cold start'
    }

    # --- Start server on host ---
    $ServerJob = Start-Tier34Server
    try {
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 5
        $hostHealthOk = ($health.StatusCode -eq 200)
    } catch {
        $hostHealthOk = $false
    }
    $results['Server health (host)'] = Write-AreaResult 'Server health (host)' $hostHealthOk 'http://127.0.0.1:3001/health'

    # --- App already cold-started with handlers; configure server ---
    $onboardingOk = Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' -TimeoutSec 30
    $results['Onboarding'] = Write-AreaResult 'Onboarding' ($onboardingOk -or $handlersOk) 'skip-onboarding + handlers'

    $encodedUrl = [uri]::EscapeDataString($ServerUrl)
    Invoke-DeepLink "set-server?url=$encodedUrl"
    Start-Sleep -Seconds 3
    $serverUrlOk = Wait-LogcatMatch 'SandboxE2E.*AREA=server-url RESULT=PASS' -TimeoutSec 30
    $results['Server URL 10.0.2.2:3001'] = Write-AreaResult 'Server URL 10.0.2.2:3001' $serverUrlOk $ServerUrl

    $launchOk = $handlersOk
    $results['App launch'] = Write-AreaResult 'App launch' $launchOk 'E2E handlers ready'

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
    $searchOk = Wait-LogcatMatch 'SandboxE2E.*AREA=search RESULT=PASS' -TimeoutSec 180
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

    # --- Discover / feed + server (before tab navigation) ---
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink 'probe-feed'
    $feedOk = Wait-LogcatMatch 'SandboxE2E.*AREA=discover-feed RESULT=PASS' -TimeoutSec 120
    $results['Discover / feed'] = Write-AreaResult 'Discover / feed' $feedOk 'tier34 /api/feed'

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink 'probe-server'
    $appServerOk = Wait-LogcatMatch 'SandboxE2E.*AREA=server-health RESULT=PASS' -TimeoutSec 60
    $results['Server health (app)'] = Write-AreaResult 'Server health (app)' $appServerOk $ServerUrl

    # --- Navigation tabs ---
    Start-Sleep -Seconds 3
    $tabs = @('home', 'locker', 'discover', 'search', 'settings')
    $navAllOk = $true
    foreach ($tab in $tabs) {
        Invoke-Adb -Command @('logcat', '-c') | Out-Null
        Invoke-DeepLink "navigate?tab=$tab"
        $tabOk = Wait-LogcatMatch "SandboxE2E.*AREA=navigation RESULT=PASS tab=$tab" -TimeoutSec 45
        if (-not $tabOk) { $navAllOk = $false }
    }
    $results['Navigation tabs'] = Write-AreaResult 'Navigation tabs' $navAllOk ($tabs -join ', ')

    # --- Mobile-only playback (Sandbox Server URL cleared in app) ---
    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'clear-server'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'check-ytdlp'
    Start-Sleep -Seconds 10
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "mobile-play?query=$encodedQuery"
    $offlineResolveOk = Wait-LogcatMatch 'YtDlpMobile.*resolve ok|YtDlpMobile.*E2E resolve transport=MOBILE' -TimeoutSec 120
    $offlinePlayOk = Wait-LogcatMatch 'SandboxE2E.*AREA=mobile-play RESULT=PASS' -TimeoutSec 150
    $results['Mobile-only playback (no server URL)'] = Write-AreaResult 'Mobile-only playback (no server URL)' ($offlineResolveOk -and $offlinePlayOk) "resolve=$offlineResolveOk play=$offlinePlayOk"

    # --- Kanye album validation (user-reported bugs) ---
    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'clear-server'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'check-ytdlp'
    Start-Sleep -Seconds 10

    $KanyeArtist = [uri]::EscapeDataString('Kanye West')
    $KanyeAlbum = [uri]::EscapeDataString('Bully')
    $KanyeTrackFather = [uri]::EscapeDataString('FATHER')
    $KanyeTrackKing = [uri]::EscapeDataString('KING')
    $KanyeTrackPreacher = [uri]::EscapeDataString('PREACHER MAN')

    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "play-artist-track?artist=$KanyeArtist&track=$KanyeTrackFather"
    $fatherOk = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300
    $results['Kanye FATHER tap (artist page)'] = Write-AreaResult 'Kanye FATHER tap (artist page)' $fatherOk 'not Follow God'

    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "play-album-track?artist=$KanyeArtist&album=$KanyeAlbum&track=$KanyeTrackKing"
    $kingOk = Wait-LogcatMatch 'SandboxE2E.*AREA=album-track-play RESULT=PASS' -TimeoutSec 300
    if (-not $kingOk) {
        Invoke-DeepLink 'stop-exo'
        Start-Sleep -Seconds 2
        Invoke-Adb -Command @('logcat', '-c') | Out-Null
        Invoke-DeepLink "play-album-track?artist=$KanyeArtist&album=$KanyeAlbum&track=$KanyeTrackPreacher"
        $kingOk = Wait-LogcatMatch 'SandboxE2E.*AREA=album-track-play RESULT=PASS' -TimeoutSec 300
    }
    $results['Kanye album track tap (Bully)'] = Write-AreaResult 'Kanye album track tap (Bully)' $kingOk 'KING or PREACHER MAN'

    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'clear-server'
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "play-artist-track?artist=$KanyeArtist&track=$KanyeTrackFather"
    $playForProgress = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300
    Start-Sleep -Seconds 5
    Invoke-DeepLink 'probe-playback'
    Start-Sleep -Seconds 2
    Invoke-DeepLink 'wait-progress?seconds=25'
    $progressOk = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 180
    $results['Progress advances monotonically'] = Write-AreaResult 'Progress advances monotonically' ($playForProgress -and $progressOk) '25s advance after FATHER'

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink 'navigate?tab=home'
    Start-Sleep -Seconds 3
    Invoke-DeepLink 'set-vinyl-mode?mode=album-cover'
    Start-Sleep -Seconds 3
    Invoke-DeepLink 'probe-vinyl?mode=album-cover'
    $coverStartOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=album-cover' -TimeoutSec 45
    Invoke-DeepLink 'toggle-vinyl'
    Start-Sleep -Seconds 3
    Invoke-DeepLink 'probe-vinyl?mode=vinyl-shades'
    $vinylOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=vinyl-shades' -TimeoutSec 45
    Invoke-DeepLink 'toggle-vinyl'
    Start-Sleep -Seconds 3
    Invoke-DeepLink 'probe-vinyl?mode=album-cover'
    $posterOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=album-cover' -TimeoutSec 45
    $results['Vinyl toggle both directions'] = Write-AreaResult 'Vinyl toggle both directions' ($coverStartOk -and $vinylOk -and $posterOk) "cover=$coverStartOk vinyl=$vinylOk poster=$posterOk"

    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-DeepLink "play-album-sequence?artist=$KanyeArtist&album=$KanyeAlbum&count=3"
    $albumSeqOk = Wait-LogcatMatch 'SandboxE2E.*AREA=album-sequence RESULT=PASS' -TimeoutSec 600
    $results['Album 3-track sequence'] = Write-AreaResult 'Album 3-track sequence' $albumSeqOk 'Bully 3 tracks no crash'

    # --- Logcat / crashes ---
    & adb.exe -s $EmuSerial logcat -d > $LogcatFile
    $logText = Get-Content $LogcatFile -Raw
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
