# Physical phone — many fresh songs + podcasts (never FATHER/KING cache magnets).
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild,
    [int]$ProgressSeconds = 18,
    [switch]$Quick
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.phone-multi-stress-report.json'
$LogPath = Join-Path $Root '.phone-multi-stress-logcat.txt'

$MusicTracks = @(
    @{ Artist = 'Tyler, The Creator'; Track = 'See You Again (feat. Kali Uchis)' },
    @{ Artist = 'Radiohead'; Track = 'Everything In Its Right Place' },
    @{ Artist = 'JPEGMAFIA'; Track = 'PRONE!' },
    @{ Artist = 'Kanye West'; Track = 'Devil In A New Dress' },
    @{ Artist = 'Frank Ocean'; Track = 'Pink + White' },
    @{ Artist = 'Kanye West'; Track = 'Ghost Town (feat. PARTYNEXTDOOR)' },
    @{ Artist = 'Billie Eilish'; Track = 'when the party''s over' },
    @{ Artist = 'Arctic Monkeys'; Track = 'Do I Wanna Know?' },
    @{ Artist = 'Kendrick Lamar'; Track = 'HUMBLE.' },
    @{ Artist = 'Denzel Curry'; Track = 'Ultimate' },
    @{ Artist = 'SZA'; Track = 'Kill Bill' },
    @{ Artist = 'Bon Iver'; Track = 'Holocene' },
    @{ Artist = 'Cigarettes After Sex'; Track = 'Apocalypse' }
)

$PodcastQueries = @(
    'Joe Rogan Experience',
    'Wrestle Talk Podcast',
    'Jim Cornette Experience',
    'Syntax FM'
)

if ($Quick) {
    $MusicTracks = $MusicTracks | Select-Object -First 6
    $PodcastQueries = $PodcastQueries | Select-Object -First 2
}

function Get-FullLogcat {
    param([int]$Tail = 15000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        return (& adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String)
    } finally { $ErrorActionPreference = $prev }
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 300)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat
        Update-PlaySpineSeen $chunk
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') {
            throw 'App crash detected during stress test'
        }
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-AppReady {
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat -Tail 5000
        if (($chunk -match 'AREA=bridge RESULT=PASS') -and ($chunk -match 'AREA=handlers RESULT=PASS')) {
            Start-Sleep -Seconds 3
            return
        }
        Start-Sleep -Seconds 2
    }
    throw 'E2E bridge/handlers not ready within 120s'
}

function Invoke-Bootstrap {
    param([switch]$FreshCaches)
    Start-E2eDeepLink -Path 'skip-onboarding'
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' 90)) {
        throw 'skip-onboarding failed'
    }
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 60)) {
        Start-E2eDeepLink -Path 'probe-handlers'
        if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90)) {
            throw 'E2E handlers not ready'
        }
    }
    Start-E2eDeepLink -Path 'enable-podcasts'
    if ($FreshCaches) {
        Invoke-PhonePlaybackCacheClear | Out-Null
    }
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
adb.exe -s $Serial shell svc power stayon usb 2>$null | Out-Null
Install-E2eApk -ApkPath $apk
& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2

Write-Host 'Cold-starting app...' -ForegroundColor Cyan
& adb.exe -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Wait-AppReady
Invoke-Bootstrap -FreshCaches

$trackResults = @()
$sw = [System.Diagnostics.Stopwatch]::StartNew()

foreach ($t in $MusicTracks) {
    if ($script:PhoneBannedTracks -contains $t.Track) { continue }
    $encA = [uri]::EscapeDataString($t.Artist)
    $encT = [uri]::EscapeDataString($t.Track)
    Write-Host ''
    Write-Host ("=== MUSIC: {0} - {1} ===" -f $t.Artist, $t.Track) -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null
    Reset-PlaySpineSeen
    Start-E2eDeepLink -Path "play-artist-track?artist=$encA&track=$encT&progressSeconds=$ProgressSeconds&integritySeconds=0&playTimeoutMs=300000"
    $playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 360
    $progressOk = $false
    $freshOk = $false
    $cachedFather = $false
    $streamKind = $null
    $nativeMs = $null
    if ($playOk) {
        $progressOk = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 150
        $log = Get-FullLogcat -Tail 25000
        try {
            $timing = Assert-PhoneFreshPlayback -LogText $log -Label $t.Track
            $freshOk = [bool]$timing.freshResolve
            $cachedFather = [bool]$timing.cachedFatherHit
            $streamKind = $timing.streamKind
            $nativeMs = $timing.nativeResolveMs
        } catch {
            $cachedFather = $true
        }
    }
    $pass = $playOk -and $progressOk -and (-not $cachedFather)
    $mark = if ($pass) { 'PASS' } else { 'FAIL' }
    Write-Host "$mark  play=$playOk progress=$progressOk fresh=$freshOk fatherCache=$cachedFather kind=$streamKind" -ForegroundColor $(if ($pass) { 'Green' } else { 'Red' })
    $trackResults += [ordered]@{
        artist = $t.Artist
        track = $t.Track
        pass = $pass
        play = $playOk
        progress = $progressOk
        freshResolve = $freshOk
        cachedFatherHit = $cachedFather
        streamKind = $streamKind
        nativeResolveMs = $nativeMs
    }
    Start-E2eDeepLink -Path 'stop-exo'
    Start-Sleep -Seconds 3
}

$podcastResults = @()
Write-Host ''
Write-Host 'Re-bootstrap before podcasts (fresh handlers + caches)...' -ForegroundColor Cyan
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& adb.exe -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Wait-AppReady
Invoke-Bootstrap -FreshCaches

foreach ($q in $PodcastQueries) {
    Write-Host ''
    Write-Host "=== PODCAST: $q ===" -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null
    $encQ = [uri]::EscapeDataString($q)
    Start-E2eDeepLink -Path "podcast-play?query=$encQ&playTimeoutMs=240000"
    $podOk = Wait-LogcatMatch 'SandboxE2E.*AREA=podcast-play RESULT=PASS' -TimeoutSec 300
    $mark = if ($podOk) { 'PASS' } else { 'FAIL' }
    Write-Host "$mark  podcast-play" -ForegroundColor $(if ($podOk) { 'Green' } else { 'Red' })
    $podcastResults += [ordered]@{
        query = $q
        pass = $podOk
    }
    Start-Sleep -Seconds 2
}

$sw.Stop()
$fullLog = Get-FullLogcat -Tail 50000
$fullLog | Set-Content -Path $LogPath -Encoding UTF8
$noFatal = -not ($fullLog -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic')
$tracksPass = @($trackResults | Where-Object { $_.pass }).Count
$podsPass = @($podcastResults | Where-Object { $_.pass }).Count

$report = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    elapsedMin = [Math]::Round($sw.Elapsed.TotalMinutes, 1)
    tracksPass = "$tracksPass/$($MusicTracks.Count)"
    podcastsPass = "$podsPass/$($PodcastQueries.Count)"
    noFatal = $noFatal
    tracks = $trackResults
    podcasts = $podcastResults
}
$report | ConvertTo-Json -Depth 6 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host ''
Write-Host '=== MULTI-TRACK + PODCAST STRESS ===' -ForegroundColor Cyan
Write-Host "Music:    $($report.tracksPass)"
Write-Host "Podcasts: $($report.podcastsPass)"
Write-Host "Crashes:  $(if ($noFatal) { 'none' } else { 'FATAL seen' })"
Write-Host "Elapsed:  $($report.elapsedMin) min"
Write-Host "Report:   $ReportPath"

foreach ($fail in ($trackResults | Where-Object { -not $_.pass })) {
    Write-Host ("  FAIL track: {0} - {1}" -f $fail.artist, $fail.track) -ForegroundColor Red
}
foreach ($fail in ($podcastResults | Where-Object { -not $_.pass })) {
    Write-Host ("  FAIL podcast: {0}" -f $fail.query) -ForegroundColor Red
}

if ($tracksPass -lt $MusicTracks.Count -or $podsPass -lt [Math]::Max(1, [Math]::Floor($PodcastQueries.Count * 0.75)) -or -not $noFatal) {
    exit 1
}
exit 0
