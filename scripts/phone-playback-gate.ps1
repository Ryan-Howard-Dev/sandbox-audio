# Physical device playback gate — arm64 install + fresh mobile resolve (not cached FATHER).
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild,
    [string]$Artist = '',
    [string]$Track = ''
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$pick = Get-PhoneFreshTrack -Artist $Artist -Track $Track
$Artist = $pick.Artist
$Track = $pick.Track

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$GateReport = Join-Path $Root '.phone-e2e-gate.json'

function Get-LogcatChunk {
    param([int]$Tail = 15000)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $console = & adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String
        return $console
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if ((& adb.exe -s $Serial get-state 2>$null) -ne 'device') {
            Start-Sleep -Seconds 2
            continue
        }
        $chunk = Get-LogcatChunk
        Update-PlaySpineSeen $chunk
        Update-PlaySpineSeen (Get-PlaySpineLogcatChunk)
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-PlaySpine {
    param([string]$Label = 'play-spine')
    return Test-PlaySpineAccumulated -Label $Label
}

$state = & adb.exe -s $Serial get-state 2>&1
if ($state -ne 'device') {
    $devices = & adb.exe devices 2>$null | Out-String
    throw "Device $Serial not ready (state=$state). adb devices:`n$devices"
}

if (-not $SkipBuild) {
    Write-Host 'Building arm64 debug APK...'
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }

& adb.exe -s $Serial install -r $apk | Out-Null
& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2

function Wait-AppReady {
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk -Tail 4000
        $bridgeOk = $chunk -match 'SandboxE2E.*AREA=bridge RESULT=PASS'
        $handlersOk = $chunk -match 'SandboxE2E.*AREA=handlers RESULT=PASS'
        if ($bridgeOk -and $handlersOk) {
            Start-Sleep -Seconds 3
            return
        }
        Start-Sleep -Seconds 2
    }
    throw 'E2E bridge/handlers not ready within 120s'
}

Write-Host 'Cold-starting app ...'
& adb.exe -s $Serial shell "am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n rd.sheepskin.sandboxmusic/.MainActivity" 2>&1 | Out-Null
Write-Host 'Waiting for WebView + E2E bridge ...'
Wait-AppReady

function Invoke-BootstrapE2e {
    param([string]$LinkPath, [string]$WaitPattern, [int]$TimeoutSec = 120, [int]$Retries = 3)
    for ($i = 0; $i -lt $Retries; $i += 1) {
        Start-E2eDeepLink -Path $LinkPath
        if (Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec) { return $true }
        Write-Host "Bootstrap retry $($i + 1)/$Retries for $LinkPath" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    return $false
}

if (-not (Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 120 5)) {
    throw 'Bootstrap failed: skip-onboarding'
}
if (-not (Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 120 5)) {
    throw 'Bootstrap failed: E2E handlers'
}

Write-Host 'Clearing playback caches (incl. native ytdlp-playback) ...' -ForegroundColor Cyan
$ytdlpCleared = Invoke-PhonePlaybackCacheClear
Write-Host ("ytdlp-playback cache empty: " + $(if ($ytdlpCleared) { 'yes' } else { 'unknown/failed' }))

$encArtist = [uri]::EscapeDataString($Artist)
$encTrack = [uri]::EscapeDataString($Track)

Write-Host "Fresh-resolve play: $Artist — $Track" -ForegroundColor Cyan

& adb.exe -s $Serial logcat -c | Out-Null
Reset-PlaySpineSeen
Start-E2eDeepLink -Path "play-artist-track?artist=$encArtist&track=$encTrack&progressSeconds=25&integritySeconds=0&playTimeoutMs=300000"

$playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 360
$progressOk = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 120
$spine = Test-PlaySpine -Label 'phone-play-spine'

$logText = Get-LogcatChunk -Tail 80000
$logText | Set-Content -Path (Join-Path $Root '.e2e-phone-logcat.txt') -Encoding UTF8
$timing = Measure-FreshPlayTiming -LogText $logText -TrackName $Track

$freshOk = [bool]$timing.freshResolve
$allPass = $playOk -and $progressOk -and $spine.Pass -and (-not $timing.cachedFatherHit)
if ($timing.cachedFatherHit) {
    Write-Host 'FAIL: cached FATHER shortcut detected — not a valid fresh-resolve test' -ForegroundColor Red
}
$gate = [ordered]@{
    serial    = $Serial
    pass      = $allPass
    track     = $Track
    artist    = $Artist
    artistTrackPlay = $playOk
    playbackProgress = $progressOk
    freshResolve = $freshOk
    ytdlpCacheCleared = $ytdlpCleared
    timing = @{
        resolveLagSec = $timing.resolveLagSec
        playLagSec    = $timing.playLagSec
        totalLagSec   = $timing.totalLagSec
        nativeResolveMs = $timing.nativeResolveMs
        hasUrl        = $timing.hasUrl
        source        = $timing.source
        ytdlpResolve  = $timing.ytdlpResolve
        streamKind    = $timing.streamKind
        cachedFatherHit = $timing.cachedFatherHit
        playbackUrl   = $timing.playbackUrl
    }
    playSpine = @{
        handlePlayEnvelope = $spine.Checks.handlePlayEnvelope
        playUrl = $spine.Checks.playUrl
        exoActive = $spine.Checks.exoActive
    }
}
($gate | ConvertTo-Json -Depth 5) | Set-Content -Path $GateReport -Encoding UTF8

Write-Host ''
Write-Host "=== PHONE PLAYBACK GATE ($Serial) ===" -ForegroundColor Cyan
Write-Host "track: $Track"
Write-Host ("artist-track-play: " + $(if ($playOk) { 'PASS' } else { 'FAIL' }))
Write-Host ("playback-progress: " + $(if ($progressOk) { 'PASS' } else { 'FAIL' }))
Write-Host ("play spine: " + $(if ($spine.Pass) { 'PASS' } else { 'FAIL' }))
Write-Host ("fresh mobile resolve: " + $(if ($freshOk) { 'PASS (not cached FATHER)' } else { 'WARN — may have used cache' }))
if ($timing.streamKind) { Write-Host "stream kind: $($timing.streamKind)" }
if ($null -ne $timing.resolveLagSec) {
    Write-Host ("tap→resolved: {0:N1}s | resolved→Exo load: {1:N1}s | tap→load: {2:N1}s" -f $timing.resolveLagSec, $(if ($timing.playLagSec) { $timing.playLagSec } else { 0 }), $(if ($timing.totalLagSec) { $timing.totalLagSec } else { 0 }))
}
if ($timing.nativeResolveMs) { Write-Host "native yt-dlp resolve: $($timing.nativeResolveMs)ms" }
if ($timing.playbackUrl) { Write-Host "playback url: $($timing.playbackUrl)" }
Write-Host "Report: $GateReport"

if (-not $allPass) { exit 1 }
exit 0
