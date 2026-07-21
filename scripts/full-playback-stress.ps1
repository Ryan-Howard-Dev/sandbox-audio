# Full playback stress — locker + search + podcast stream/offline on a physical device.
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild,
    [int]$ProgressSeconds = 12
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.full-playback-stress-report.json'
$LogPath = Join-Path $Root '.full-playback-stress-logcat.txt'

$LockerTracks = @(
    @{ Artist = 'Kanye West'; Track = 'King'; Album = 'Donda' },
    @{ Artist = 'Kanye West'; Track = 'Come to Life'; Album = 'Donda' },
    @{ Artist = 'Kanye West'; Track = 'Off The Grid'; Album = 'Donda' }
)

# Vary search seeds per script — avoid a single canonical track (e.g. overused pop hits) that skews stress runs.
$SearchQueries = @('radiohead creep', 'kanye west king', 'daft punk harder better faster')
$PodcastQueries = @('Joe Rogan Experience', 'Wrestle Talk Podcast')
$PodcastOfflineQuery = 'Wrestle Talk Podcast'

function Get-FullLogcat {
    param([int]$Tail = 12000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { return (& adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String) }
    finally { $ErrorActionPreference = $prev }
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') {
            throw 'App crash detected during stress test'
        }
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-AppReady {
    $deadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat -Tail 8000
        if (
            ($chunk -match 'AREA=handlers-probe RESULT=PASS') -or
            ($chunk -match 'AREA=handlers RESULT=PASS') -or
            ($chunk -match 'AREA=bridge RESULT=PASS')
        ) {
            Start-Sleep -Seconds 2
            return
        }
        Start-E2eDeepLink -Path 'probe-handlers' 2>$null | Out-Null
        Start-Sleep -Seconds 3
    }
    throw 'E2E bridge/handlers not ready within 180s'
}

function Invoke-Bootstrap {
    Start-E2eDeepLink -Path 'skip-onboarding'
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90)) { throw 'skip-onboarding failed' }
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 60)) {
        Start-E2eDeepLink -Path 'probe-handlers'
        if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90)) { throw 'handlers not ready' }
    }
    Start-E2eDeepLink -Path 'enable-podcasts'
}

function Test-PlaybackProgress {
    param(
        [string]$Name,
        [string]$DeepLinkPath,
        [string]$PassPattern,
        [int]$TimeoutSec = 300
    )
    Write-Host "`n=== $Name ===" -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null
    $startPos = 0
    Start-E2eDeepLink -Path $DeepLinkPath
    $playOk = Wait-LogcatMatch $PassPattern -TimeoutSec $TimeoutSec
    Start-Sleep -Seconds $ProgressSeconds
    $log = Get-FullLogcat -Tail 20000
    $exo = [regex]::Match($log, 'NativeExoPlayback.*positionSecs[=:](\d+(?:\.\d+)?)', 'IgnoreCase')
    if (-not $exo.Success) {
        $exo = [regex]::Match($log, '"positionSecs"\s*:\s*(\d+(?:\.\d+)?)')
    }
    $pos = if ($exo.Success) { [double]$exo.Groups[1].Value } else { 0 }
    $playing = $log -match 'state=playing|"state"\s*:\s*"playing"' -or $log -match 'playing=true'
    $pass = $playOk -and (($pos -gt 0.2) -or $playing)
    $evidence = if ($pass) {
        "PASS pattern=$PassPattern pos=$pos playing=$playing"
    } else {
        "FAIL pattern=$PassPattern matched=$playOk pos=$pos playing=$playing"
    }
    Write-Host $(if ($pass) { 'PASS' } else { 'FAIL' }) $evidence -ForegroundColor $(if ($pass) { 'Green' } else { 'Red' })
    Start-E2eDeepLink -Path 'stop-exo' | Out-Null
    Start-Sleep -Seconds 2
    return [ordered]@{ name = $Name; pass = $pass; evidence = $evidence }
}

$state = & adb.exe -s $Serial get-state 2>&1
if ($state -ne 'device') { throw "Device $Serial not ready: $state" }

if (-not $SkipBuild) {
    Write-Host 'Building arm64 debug APK...' -ForegroundColor Cyan
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }

adb.exe -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
Install-E2eApk -ApkPath $apk
& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& adb.exe -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Wait-AppReady
Invoke-Bootstrap

$results = @()

# Locker diagnostics
& adb.exe -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path 'dump-locker'
Start-Sleep -Seconds 6
$dumpLog = Get-FullLogcat -Tail 4000
$dumpMatch = [regex]::Match($dumpLog, 'SandboxE2E.*AREA=dump-locker RESULT=(PASS|FAIL)[^\n]*([^\n]*)')
$dumpPass = $dumpMatch.Groups[1].Value -eq 'PASS'
$dumpEvidence = if ($dumpMatch.Success) { $dumpMatch.Value.Trim() } else { 'no dump-locker log' }
$results += [ordered]@{ name = 'dump-locker'; pass = $dumpPass; evidence = $dumpEvidence }

foreach ($t in $LockerTracks) {
    $encA = [uri]::EscapeDataString($t.Artist)
    $encT = [uri]::EscapeDataString($t.Track)
    $encAl = [uri]::EscapeDataString($t.Album)
    $path = "play-offline?artist=$encA&track=$encT&album=$encAl"
    $results += Test-PlaybackProgress -Name "locker:$($t.Track)" -DeepLinkPath $path -PassPattern 'SandboxE2E.*AREA=play-offline RESULT=PASS' -TimeoutSec 240
}

foreach ($q in $SearchQueries) {
    $enc = [uri]::EscapeDataString($q)
    Start-E2eDeepLink -Path 'stop-exo' | Out-Null
    Start-Sleep -Seconds 2
    Start-E2eDeepLink -Path 'clear-playback-caches' | Out-Null
    Clear-DeviceYtdlpPlaybackCache | Out-Null
    Start-Sleep -Seconds 2
    $results += Test-PlaybackProgress -Name "search:$q" -DeepLinkPath "search-play?query=$enc&playTimeoutMs=360000" -PassPattern 'SandboxE2E.*AREA=search-play RESULT=PASS' -TimeoutSec 420
}

foreach ($q in $PodcastQueries) {
    $enc = [uri]::EscapeDataString($q)
    $results += Test-PlaybackProgress -Name "podcast-stream:$q" -DeepLinkPath "podcast-play?query=$enc&playTimeoutMs=240000" -PassPattern 'SandboxE2E.*AREA=podcast-play RESULT=PASS' -TimeoutSec 300
}

$encOff = [uri]::EscapeDataString($PodcastOfflineQuery)
& adb.exe -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path "cache-podcast-offline?query=$encOff"
$cacheOk = Wait-LogcatMatch 'SandboxE2E.*AREA=cache-podcast-offline RESULT=PASS' -TimeoutSec 360
$cacheLog = Get-FullLogcat -Tail 8000
$cacheEvidence = if ($cacheMatch = [regex]::Match($cacheLog, 'SandboxE2E.*AREA=cache-podcast-offline[^\n]*')) { $cacheMatch.Value.Trim() } else { "cache matched=$cacheOk" }
$results += [ordered]@{ name = 'podcast-cache-offline'; pass = $cacheOk; evidence = $cacheEvidence }

$results += Test-PlaybackProgress -Name 'podcast-offline-play' -DeepLinkPath 'play-offline-podcast?index=0' -PassPattern 'SandboxE2E.*AREA=play-offline-podcast RESULT=PASS' -TimeoutSec 240

$fullLog = Get-FullLogcat -Tail 50000
$fullLog | Set-Content -Path $LogPath -Encoding UTF8
$report = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    results = $results
    passCount = @($results | Where-Object { $_.pass }).Count
    total = $results.Count
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host "`n=== FULL PLAYBACK STRESS ===" -ForegroundColor Cyan
Write-Host "Pass: $($report.passCount)/$($report.total)"
Write-Host "Report: $ReportPath"
foreach ($r in $results) {
    $color = if ($r.pass) { 'Green' } else { 'Red' }
    Write-Host ("{0,-28} {1}  {2}" -f $r.name, $(if ($r.pass) { 'PASS' } else { 'FAIL' }), $r.evidence) -ForegroundColor $color
}

if ($report.passCount -lt $report.total) { exit 1 }
exit 0
