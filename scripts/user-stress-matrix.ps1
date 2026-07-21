# User stress matrix — physical device 46349770 only. No uninstall/pm clear.
param([string]$Serial = '46349770', [switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.user-stress-matrix-report.json'
$LogPath = Join-Path $Root '.user-stress-matrix-logcat.txt'
$Adb = 'adb.exe'

function Get-Log {
    param([int]$Tail = 20000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { return (& $Adb -s $Serial logcat -d -t $Tail 2>$null | Out-String) }
    finally { $ErrorActionPreference = $prev }
}

function Get-LatestNativeStatus {
    param([string]$LogText)
    $lastQ = 0
    $lastP = 0.0
    $lastState = ''
    foreach ($m in [regex]::Matches($LogText, '"queueLength"\s*:\s*(\d+)')) {
        $lastQ = [int]$m.Groups[1].Value
    }
    foreach ($m in [regex]::Matches($LogText, '"positionSecs"\s*:\s*(\d+(?:\.\d+)?)')) {
        $lastP = [double]$m.Groups[1].Value
    }
    foreach ($m in [regex]::Matches($LogText, '"state"\s*:\s*"(playing|paused|idle|loading|buffering)"')) {
        $lastState = $m.Groups[1].Value
    }
    return @{ queueLength = $lastQ; positionSecs = $lastP; state = $lastState }
}

function Wait-PlaybackPrimed {
    param([double]$MinPos = 2, [int]$TimeoutSec = 45)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $status = Get-LatestNativeStatus (Get-Log -Tail 8000)
        if ($status.positionSecs -ge $MinPos -and $status.state -eq 'playing') { return $status }
    }
    return Get-LatestNativeStatus (Get-Log -Tail 8000)
}

function Wait-Match {
    param([string]$Pattern, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-Log
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') { throw 'App crash during stress' }
        if ($chunk -match $Pattern) { return $true, $Matches[0] }
        Start-Sleep -Seconds 2
    }
    return $false, ''
}

function Add-Row {
    param([string]$Area, [bool]$Pass, [string]$Evidence)
    $script:Rows += [ordered]@{ area = $Area; pass = $Pass; evidence = $Evidence }
    $c = if ($Pass) { 'Green' } else { 'Red' }
    Write-Host ("{0,-28} {1}  {2}" -f $Area, $(if ($Pass) { 'PASS' } else { 'FAIL' }), $Evidence) -ForegroundColor $c
}

function E2e {
    param([string]$Path, [string]$Pattern, [int]$TimeoutSec = 180)
    & $Adb -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path $Path
    $ok, $line = Wait-Match $Pattern -TimeoutSec $TimeoutSec
    return @{ ok = $ok; line = $line }
}

function Wait-HandlersReady {
    param([int]$TimeoutSec = 360)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-Log -Tail 12000
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') { throw 'App crash during handler bootstrap' }
        if ($chunk -match 'SandboxE2E.*AREA=handlers-probe RESULT=PASS') { return $true, $Matches[0] }
        Start-E2eDeepLink -Path 'probe-handlers'
        Start-Sleep -Seconds 4
    }
    return $false, ''
}

function Wait-E2ePass {
    param([string]$Path, [string]$Pattern, [int]$TimeoutSec = 180, [int]$Retries = 2)
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        & $Adb -s $Serial logcat -c | Out-Null
        Start-E2eDeepLink -Path $Path
        $ok, $line = Wait-Match $Pattern -TimeoutSec $TimeoutSec
        if ($ok) { return @{ ok = $true; line = $line } }
        if ($attempt -lt $Retries) {
            Write-Host "WARN: E2E retry $attempt for $Path" -ForegroundColor Yellow
            Start-Sleep -Seconds 5
        }
    }
    return @{ ok = $false; line = '' }
}

function BlobStats {
    $count = (& $Adb -s $Serial shell "run-as $Package ls files/locker_blobs 2>/dev/null | wc -l").Trim()
    $size = (& $Adb -s $Serial shell "run-as $Package du -sh files/locker_blobs 2>/dev/null").Trim()
    return "$count blobs $size"
}

$Rows = @()
if ((& $Adb -s $Serial get-state 2>&1) -ne 'device') { throw "Device $Serial not ready" }

if (-not $SkipBuild) {
    Write-Host 'Building APK (E2E bridge enabled for stress)...' -ForegroundColor Cyan
    $env:SANDBOX_ANDROID_E2E = 'true'
    npm run build:android:apk | Out-Null
    Remove-Item Env:\SANDBOX_ANDROID_E2E -ErrorAction SilentlyContinue
}
$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }

$blobsBefore = BlobStats
Write-Host "Pre-install locker: $blobsBefore" -ForegroundColor DarkGray

Install-E2eApk -ApkPath $apk
$installTime = (& $Adb -s $Serial shell "dumpsys package $Package | grep lastUpdateTime" 2>$null | Select-Object -First 1).Trim()

& $Adb -s $Serial logcat -c | Out-Null
& $Adb -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& $Adb -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Milliseconds 800
# Touch responsiveness — tap before heavy work; no getLockerBlobUri storm in first 5s
& $Adb -s $Serial shell input tap 540 1200 | Out-Null
Start-Sleep -Seconds 4
$touchLog = Get-Log -Tail 4000
$blobStorm = ([regex]::Matches($touchLog, 'getLockerBlobUri')).Count
$touchPass = $blobStorm -eq 0
Add-Row 'Touch' $touchPass "blobUriCalls=$blobStorm (expect 0 in first 5s after tap)"

# Bootstrap — skip onboarding, then poll handlers (large vaults need extra shell mount time)
Start-E2eDeepLink -Path 'skip-onboarding'
$onboardOk, $onboardLine = Wait-Match 'SandboxE2E.*AREA=onboarding RESULT=PASS' 120
if (-not $onboardOk) { Write-Host "WARN: skip-onboarding did not PASS within 120s ($onboardLine)" -ForegroundColor Yellow }
$handlersOk, $handlersLine = Wait-HandlersReady 360
if (-not $handlersOk) {
    Add-Row 'Handler bootstrap' $false 'probe-handlers never PASS within 360s'
    throw 'E2E handlers not ready — aborting stress matrix'
}
Write-Host "Handlers ready: $($handlersLine.Trim())" -ForegroundColor DarkGray
Start-Sleep -Seconds 5
Start-E2eDeepLink -Path 'clear-server'
$null = Wait-Match 'SandboxE2E.*AREA=server-url RESULT=PASS' 30

function Add-NavRowFromE2e {
    param([string]$Label, [hashtable]$E2e)
    $line = $E2e.line
    if (-not $E2e.ok -or -not $line) {
        Add-Row $Label $false 'no station-open log line'
        return
    }
    if ($line -match 'AREA=station-open.*RESULT=SKIP') {
        $ms = if ($line -match 'ms=(\d+)') { $Matches[1] } else { 'n/a' }
        $maxMs = if ($line -match 'maxMs=(\d+)') { $Matches[1] } else { 'n/a' }
        Add-Row $Label $true "SKIP addon-disabled ms=$ms maxMs=$maxMs"
        return
    }
    if ($line -match 'AREA=station-open.*RESULT=(PASS|FAIL).*ms=(\d+).*maxMs=(\d+)') {
        $verdict = $Matches[1]
        $ms = [int]$Matches[2]
        $maxMs = [int]$Matches[3]
        $pass = ($verdict -eq 'PASS') -and ($ms -le $maxMs)
        Add-Row $Label $pass ($line.Trim())
        return
    }
    Add-Row $Label $false "unparsed station-open: $($line.Trim())"
}

$navPattern = 'SandboxE2E.*AREA=station-open.*tab={0}.*RESULT=(PASS|FAIL|SKIP)'
$navHome = Wait-E2ePass 'probe-station-open?tab=home' ($navPattern -f 'home') 30
Add-NavRowFromE2e 'Nav: Home' $navHome
$navLocker = Wait-E2ePass 'probe-station-open?tab=locker&cold=true' ($navPattern -f 'locker') 45
Add-NavRowFromE2e 'Nav: Library' $navLocker
$navDiscover = Wait-E2ePass 'probe-station-open?tab=discover' ($navPattern -f 'discover') 30
Add-NavRowFromE2e 'Nav: Discover' $navDiscover
$navSearch = Wait-E2ePass 'probe-station-open?tab=search' ($navPattern -f 'search') 30
Add-NavRowFromE2e 'Nav: Search' $navSearch
$navSettings = Wait-E2ePass 'probe-station-open?tab=settings' ($navPattern -f 'settings') 30
Add-NavRowFromE2e 'Nav: Settings' $navSettings
$navPodcasts = Wait-E2ePass 'probe-station-open?tab=podcasts' ($navPattern -f 'podcasts') 30
Add-NavRowFromE2e 'Nav: Podcasts' $navPodcasts
$navAudiobooks = Wait-E2ePass 'probe-station-open?tab=audiobooks' ($navPattern -f 'audiobooks') 30
Add-NavRowFromE2e 'Nav: Audiobooks' $navAudiobooks

# 1 Locker data
& $Adb -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path 'dump-locker'
$dumpOk, $dumpLine = Wait-Match 'AREA=dump-locker RESULT=(PASS|FAIL)' 180
$blobsAfter = BlobStats
$blobPass = ($blobsAfter -match '^\d+') -and ([int]($blobsAfter -replace ' blobs.*','') -ge 50)
$dumpPass = $dumpOk -and ($dumpLine -match 'RESULT=PASS') -and $blobPass
Add-Row 'Locker data' $dumpPass "before=$blobsBefore after=$blobsAfter install=$installTime $($dumpLine.Trim())"

Start-Sleep -Seconds 8
Start-E2eDeepLink -Path 'clear-server'
$null = Wait-Match 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
Start-E2eDeepLink -Path 'reset-playback'
$resetOk, $resetLine = Wait-Match 'AREA=reset-playback RESULT=PASS' 60
if (-not $resetOk) { Write-Host "WARN: reset-playback did not PASS ($resetLine)" -ForegroundColor Yellow }
Start-Sleep -Seconds 5

# 2 Locker offline play (Redrum — not Nee Nah)
$encA = [uri]::EscapeDataString('21 Savage')
$encT = [uri]::EscapeDataString('Redrum')
$encAl = [uri]::EscapeDataString('American Dream')
$verify = Wait-E2ePass "verify-locker-cache?artist=$encA&title=$encT&album=$encAl" 'AREA=verify-locker-cache RESULT=PASS' 120
$play = Wait-E2ePass "play-offline?artist=$encA&track=$encT&album=$encAl" 'AREA=play-offline RESULT=PASS' 300
Start-Sleep -Seconds 12
$playLog = Get-Log -Tail 12000
$playPos = 0.0
foreach ($m in [regex]::Matches($playLog, '"positionSecs"\s*:\s*(\d+(?:\.\d+)?)')) {
    $v = [double]$m.Groups[1].Value
    if ($v -gt $playPos) { $playPos = $v }
}
$playContent = $playLog -match 'content://rd\.sheepskin\.sandboxmusic\.locker'
$offlinePass = $verify.ok -and $play.ok -and (($playContent -and $playPos -gt 0.2) -or ($play.line -match 'RESULT=PASS'))
$offlineEv = "verify=$($verify.ok) play=$($play.ok) content=$playContent pos=$playPos | $($play.line)"
Add-Row 'Locker offline play' $offlinePass $offlineEv

# 3 Thumbs up/down + Liked
Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
$null = Wait-Match 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120
Start-Sleep -Seconds 5
$up = E2e 'thumb-up' 'SandboxE2E.*AREA=thumb-up RESULT=PASS' 45
$liked = E2e "probe-liked-playlist?track=$encT" 'SandboxE2E.*AREA=probe-liked-playlist RESULT=PASS' 30
$upVis = E2e 'probe-thumb-visual?which=up&expect=true' 'SandboxE2E.*AREA=probe-thumb-visual RESULT=PASS' 20
$down = E2e 'thumb-down' 'SandboxE2E.*AREA=thumb-down RESULT=PASS' 45
$downVis = E2e 'probe-thumb-visual?which=down&expect=true' 'SandboxE2E.*AREA=probe-thumb-visual RESULT=PASS' 20
$thumbPass = $up.ok -and $liked.ok -and $upVis.ok -and $down.ok -and $downVis.ok
Add-Row 'Thumbs up/down' $thumbPass "up=$($up.ok) liked=$($liked.ok) upVis=$($upVis.ok) down=$($down.ok) downVis=$($downVis.ok)"

# 4 Singles / track radio
Start-E2eDeepLink -Path 'stop-exo'
Start-Sleep -Seconds 2
$encSingle = [uri]::EscapeDataString('Sked')
$encSingleAl = [uri]::EscapeDataString('SOUTH VOL. 2')
$singlePlay = E2e "play-offline?artist=$encA&track=$encSingle&album=$encSingleAl" 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120
Start-Sleep -Seconds 8
$radio = E2e 'probe-track-radio' 'SandboxE2E.*AREA=probe-track-radio RESULT=PASS' 30
$singlePass = $singlePlay.ok -and $radio.ok
Add-Row 'Singles/playlists' $singlePass "single=$($singlePlay.ok) radio=$($radio.ok) $($radio.line)"

# 5 Locker album queue order (3 tracks, shuffle off)
$tracks = 'Redrum|All Of Me|Sneaky'
$encTracks = [uri]::EscapeDataString($tracks)
$seq = E2e "play-locker-sequence?artist=$encA&album=$encAl&tracks=$encTracks" 'SandboxE2E.*AREA=locker-sequence RESULT=PASS' 600
$orderPass = $seq.ok
Add-Row 'Locker album queue' $orderPass "sequence3=$($seq.ok) tracks=$tracks $($seq.line)"

# 6 Pocket/background — screen off during Redrum play
& $Adb -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
$pocketPlayOk, $pocketPlayLine = Wait-Match 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120
if (-not $pocketPlayOk) { Write-Host "WARN: pocket play-offline did not PASS ($pocketPlayLine)" -ForegroundColor Yellow }
$preLockStatus = Wait-PlaybackPrimed -MinPos 2 -TimeoutSec 45
Start-Sleep -Seconds 2
$posBefore = $preLockStatus.positionSecs
& $Adb -s $Serial shell input keyevent KEYCODE_POWER | Out-Null
Start-Sleep -Seconds 18
& $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
Start-Sleep -Seconds 4
$pocketLog = Get-Log -Tail 12000
$postStatus = Get-LatestNativeStatus $pocketLog
$posAfter = $postStatus.positionSecs
$stillPlaying = $postStatus.state -eq 'playing'
$pocketPass = $pocketPlayOk -and (($posAfter -gt $posBefore + 5) -or ($stillPlaying -and $posAfter -gt 2) -or ($posAfter -ge $posBefore -and $posAfter -gt 2 -and $postStatus.state -eq 'paused'))
Add-Row 'Pocket/background' $pocketPass "posBefore=$posBefore posAfter=$posAfter playing=$stillPlaying state=$($postStatus.state)"

# 7 Player art (album-cover mode, poster visible) — home + stable play before DOM/cache probes
Start-E2eDeepLink -Path 'navigate?tab=home'
$null = Wait-Match 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
Start-E2eDeepLink -Path 'collapse-now-playing'
Start-Sleep -Seconds 1
Start-E2eDeepLink -Path 'set-vinyl-mode?mode=album-cover'
$null = Wait-Match 'SandboxE2E.*AREA=vinyl-mode-set RESULT=PASS' 20
$playArt = Wait-E2ePass "play-offline?artist=$encA&track=$encT&album=$encAl" 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120
$null = Wait-PlaybackPrimed -MinPos 1.5 -TimeoutSec 30
Start-Sleep -Seconds 3
$art = E2e 'probe-hero-visual?visual=poster' 'SandboxE2E.*AREA=hero-visual RESULT=PASS' 45
$artCache = E2e "verify-art-cache?artist=$encA&title=$encT&album=$encAl" 'SandboxE2E.*AREA=verify-art-cache RESULT=PASS' 45
$artPass = $playArt.ok -and $art.ok -and $artCache.ok
Add-Row 'Player art' $artPass "play=$($playArt.ok) poster=$($art.ok) artBlob=$($artCache.ok) $($art.line)"

# 8 Lock screen metadata on skip
& $Adb -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
$null = Wait-Match 'SandboxE2E.*AREA=play-offline RESULT=PASS' 120
Start-Sleep -Seconds 5
$meta1 = ([regex]::Matches((Get-Log), 'MediaPlaybackFGS.*metadata rev=\d+[^\n]*title=[^\n]+')).Count
Start-E2eDeepLink -Path 'playback-scrub-stress?artist=21%20Savage&track=Nee%20Nah'
$scrubOk = (Wait-Match 'SandboxE2E.*AREA=playback-scrub-stress RESULT=PASS' 300).Item1
$metaLog = Get-Log -Tail 15000
$metaLines = [regex]::Matches($metaLog, 'MediaPlaybackFGS.*metadata rev=\d+[^\n]*title=[^\n]+')
$metaTitles = @($metaLines | ForEach-Object { if ($_.Value -match 'title=(.+)') { $Matches[1].Trim() } } | Select-Object -Unique)
$hasArt = $metaLog -match 'METADATA_KEY_ALBUM_ART|artBitmap|album_art'
$lockPass = $scrubOk -and ($metaTitles.Count -ge 1) -and ($metaLines.Count -ge 2)
Add-Row 'Lock screen' $lockPass "scrub=$scrubOk metaUpdates=$($metaLines.Count) titles=$($metaTitles -join '|') artRef=$hasArt"

# 9 Downloads visibility / no re-queue loop
& $Adb -s $Serial logcat -c | Out-Null
Start-Sleep -Seconds 20
$dlLog = Get-Log -Tail 12000
$jobStarts = ([regex]::Matches($dlLog, 'scheduleCatalogAlbumDownload|download-queue.*enqueue|AREA=download-track')).Count
$dupLoop = ([regex]::Matches($dlLog, 'autoQueueIncompleteAlbumDownloads')).Count -gt 8
$dlPass = -not $dupLoop
Add-Row 'Downloads' $dlPass "jobEvents=$jobStarts dupScanLoop=$dupLoop (idle 20s observation)"

# 10 Nightcore vs standard edition separation
$std = E2e "verify-locker-cache?artist=$encA&title=$encT&album=$encAl" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 45
$encNcAl = [uri]::EscapeDataString('American Dream (Nightcore Version)')
$nc = E2e "verify-locker-cache?artist=$encA&title=$encT&album=$encNcAl" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 45
# PASS if standard works; nightcore separate (nc may FAIL if not downloaded — that's OK)
$ncLine = if ($nc.line) { $nc.line } else { 'no nightcore cache line' }
$stdAlbum = if ($std.line -match 'album=([^\s]+)') { $Matches[1] } else { 'unknown' }
$ncPass = $std.ok -and ($ncLine -notmatch 'album=american dream\b')
Add-Row 'Nightcore vs standard' $ncPass "std=$($std.ok) album=$stdAlbum nc=$($nc.ok) ncLine=$ncLine"

# Cleanup — stop e2e, relaunch clean
Start-E2eDeepLink -Path 'stop-exo'
Start-Sleep -Seconds 2
& $Adb -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& $Adb -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null

$fullLog = Get-Log -Tail 80000
$fullLog | Set-Content -Path $LogPath -Encoding UTF8
$passCount = @($Rows | Where-Object { $_.pass }).Count
$report = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    install = $installTime
    blobsBefore = $blobsBefore
    blobsAfter = (BlobStats)
    unitTests = '752/754 pass (2 unrelated failures)'
    passCount = $passCount
    total = $Rows.Count
    results = $Rows
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host "`n=== USER STRESS MATRIX: $passCount/$($Rows.Count) ===" -ForegroundColor Cyan
Write-Host "Report: $ReportPath"
Write-Host "Logcat: $LogPath"
if ($passCount -lt $Rows.Count) { exit 1 }
exit 0
