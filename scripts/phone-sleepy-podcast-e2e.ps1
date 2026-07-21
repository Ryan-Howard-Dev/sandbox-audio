# Physical phone — sleepy/calm tracks + podcast smoke (Joe Rogan, wrestling, etc.)
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.phone-sleepy-podcast-report.json'

$SleepyTracks = @(
    @{ Artist = 'Billie Eilish'; Track = 'when the party''s over' },
    @{ Artist = 'Frank Ocean'; Track = 'Pink + White' },
    @{ Artist = 'Cigarettes After Sex'; Track = 'Apocalypse' },
    @{ Artist = 'Bon Iver'; Track = 'Holocene' },
    @{ Artist = 'Mazzy Star'; Track = 'Fade Into You' }
)

$PodcastQueries = @(
    'Joe Rogan Experience',
    'Wrestle Talk Podcast',
    'Jim Cornette Experience'
)

function Get-LogcatChunk {
    param([int]$Tail = 12000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        return (& adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String)
    } finally { $ErrorActionPreference = $prev }
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Get-LogcatChunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Invoke-Bootstrap {
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' 120)) {
        Start-E2eDeepLink -Path 'skip-onboarding'
        if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90)) { throw 'skip-onboarding failed' }
    }
    Start-E2eDeepLink -Path 'enable-podcasts'
    Invoke-PhonePlaybackCacheClear | Out-Null
}

$state = & adb.exe -s $Serial get-state 2>&1
if ($state -ne 'device') { throw "Device $Serial not ready: $state" }

if (-not $SkipBuild) {
    Write-Host 'Building arm64 debug APK...' -ForegroundColor Cyan
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }

Install-E2eApk -ApkPath $apk
& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2

Write-Host 'Launching app...' -ForegroundColor Cyan
& adb.exe -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 14
Invoke-Bootstrap

$trackResults = @()
foreach ($t in $SleepyTracks) {
    $encA = [uri]::EscapeDataString($t.Artist)
    $encT = [uri]::EscapeDataString($t.Track)
    Write-Host ("Sleepy track: {0} — {1}" -f $t.Artist, $t.Track) -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "play-artist-track?artist=$encA&track=$encT&progressSeconds=20&integritySeconds=0&playTimeoutMs=300000"
    $playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 360
    $progressOk = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 120
    Start-E2eDeepLink -Path 'tab-switch-stability'
    $tabOk = Wait-LogcatMatch 'SandboxE2E.*AREA=tab-switch-stability RESULT=PASS' -TimeoutSec 90
    $trackResults += [ordered]@{
        artist = $t.Artist
        track = $t.Track
        play = $playOk
        progress = $progressOk
        tabStable = $tabOk
    }
    Start-Sleep -Seconds 2
}

$podcastResults = @()
foreach ($q in $PodcastQueries) {
    $encQ = [uri]::EscapeDataString($q)
    Write-Host ("Podcast: $q") -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "podcast-play?query=$encQ&playTimeoutMs=240000"
    $podOk = Wait-LogcatMatch 'SandboxE2E.*AREA=podcast-play RESULT=PASS' -TimeoutSec 300
    $podcastResults += [ordered]@{
        query = $q
        pass = $podOk
    }
    Start-Sleep -Seconds 2
}

$log = Get-LogcatChunk -Tail 40000
$log | Set-Content -Path (Join-Path $Root '.phone-sleepy-podcast-logcat.txt') -Encoding UTF8
$noFatal = -not ($log -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic')

$allTracks = ($trackResults | Where-Object { $_.play -and $_.progress }).Count
$allPods = ($podcastResults | Where-Object { $_.pass }).Count
$reportData = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    tracks = $trackResults
    podcasts = $podcastResults
    tracksPass = "$allTracks/$($SleepyTracks.Count)"
    podcastsPass = "$allPods/$($PodcastQueries.Count)"
    noFatal = $noFatal
}
$reportData | ConvertTo-Json -Depth 5 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host ''
Write-Host '=== SLEEPY + PODCAST PHONE REPORT ===' -ForegroundColor Cyan
Write-Host "Tracks: $($reportData.tracksPass)"
Write-Host "Podcasts: $($reportData.podcastsPass)"
Write-Host "No fatal crashes: $noFatal"
Write-Host "Report: $ReportPath"

if ($allTracks -lt $SleepyTracks.Count -or $allPods -lt 1 -or -not $noFatal) {
    exit 1
}
exit 0
