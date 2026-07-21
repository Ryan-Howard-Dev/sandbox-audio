# Sandbox Music — on-device stress E2E (physical phone 46349770)
# Locker-first: proves local-vault playback, not online search/streaming.
# Usage: .\scripts\android-device-stress-e2e.ps1 [-QuickMode] [-IncludeOnline]

param([switch]$QuickMode, [switch]$IncludeOnline)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"

$Device = '46349770'
$Adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$Artist = 'Kanye West'
$Album = 'Bully'
$SingleTrack = 'KING'
$SingleAlbum = 'Bully'
$AlbumTrack = 'FATHER'
$ReportFile = Join-Path $Root '.device-stress-report.txt'
$LogcatFile = Join-Path $Root '.device-stress-logcat.txt'

function Invoke-Adb {
    param([string[]]$Command)
    Assert-NotUserDeviceDestructiveAdb -Serial $Device -Command $Command
    & $Adb -s $Device @Command
    if ($LASTEXITCODE -ne 0) {
        throw ("adb failed: adb -s $Device " + ($Command -join ' '))
    }
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    $shell = "am start -a android.intent.action.VIEW -d '$uri' -f 0x14000000 $Package"
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    & $Adb -s $Device shell $shell 2>$null | Out-Null
    $ErrorActionPreference = $prev
}

function Get-LogcatChunk {
    param([int]$Tail = 15000)
    & $Adb -s $Device logcat -d -t $Tail 2>$null
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
        $chunk = Get-LogcatChunk
        $m = [regex]::Match($chunk, $Pattern)
        if ($m.Success) { return $true, $m.Value }
        Start-Sleep -Seconds 2
    }
    return $false, ''
}

function Invoke-E2e {
    param(
        [string]$Path,
        [string]$WaitPattern,
        [int]$TimeoutSec = 120
    )
    Write-Host "  -> $Path (timeout ${TimeoutSec}s)" -ForegroundColor DarkGray
    Invoke-DeepLink $Path
    Start-Sleep -Seconds 2
    if (-not $WaitPattern) { return $false, '' }
    return Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
}

function Add-Result {
    param([string]$Test, [bool]$Pass, [string]$Notes = '')
    $script:Results.Add([pscustomobject]@{
        Test   = $Test
        Result = if ($Pass) { 'PASS' } else { 'FAIL' }
        Notes  = $Notes
    })
    $color = if ($Pass) { 'Green' } else { 'Red' }
    Write-Host "  $($script:Results[-1].Result): $Test $Notes" -ForegroundColor $color
}

$Results = [System.Collections.Generic.List[object]]::new()

$devices = (& $Adb devices 2>$null) -join "`n"
if ($devices -notmatch "${Device}\s+device") {
    throw "Device $Device not online. Connect phone and enable USB debugging."
}

$apkPath = Join-Path $Root $ApkRel
if (-not (Test-Path $apkPath)) {
    Write-Host 'APK missing — building ...'
    npm run build:android:apk
}
if (-not (Test-Path $apkPath)) { throw "APK not found: $apkPath" }

Write-Host "Installing to $Device ..."
Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null

foreach ($perm in @(
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.READ_MEDIA_AUDIO',
    'android.permission.READ_EXTERNAL_STORAGE'
)) {
    try {
        & $Adb -s $Device shell pm grant $Package $perm 2>$null | Out-Null
    } catch { }
}

Invoke-Adb -Command @('shell', 'svc', 'power', 'stayon', 'usb') | Out-Null
Invoke-Adb -Command @('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP') | Out-Null

Invoke-Adb -Command @('logcat', '-c') | Out-Null
Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
Start-Sleep -Seconds 2

Write-Host '=== Cold start + skip onboarding ===' -ForegroundColor Cyan
Invoke-DeepLink 'skip-onboarding'
Start-Sleep -Seconds 12
$onboardOk = (Invoke-E2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45)[0]
Add-Result 'Skip onboarding' $onboardOk

Write-Host '=== Locker vault (offline, server cleared) ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
$null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30

$encArtist = [uri]::EscapeDataString($Artist)
$encSingle = [uri]::EscapeDataString($SingleTrack)
$encSingleAlbum = [uri]::EscapeDataString($SingleAlbum)

$verifyKing = (Invoke-E2e "verify-locker-cache?artist=$encArtist&title=$encSingle" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 45)[0]
Add-Result 'Locker verify (KING)' $verifyKing $(if (-not $verifyKing) { 'no playable locker bytes for KING' } else { '' })

if (-not $verifyKing) {
    Write-Host '  -> KING missing playable audio; downloading to locker ...' -ForegroundColor Yellow
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $singlePath = "download-track?artist=$encArtist&album=$encSingleAlbum&title=$encSingle&mode=tracks"
    $singleOk = (Invoke-E2e $singlePath 'SandboxE2E.*AREA=download-track RESULT=PASS' 900)[0]
    Add-Result 'Locker download (KING)' $singleOk
    if ($singleOk) {
        $verifyKing = (Invoke-E2e "verify-locker-cache?artist=$encArtist&title=$encSingle" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 45)[0]
        Add-Result 'Locker verify after download (KING)' $verifyKing
    }
}

Invoke-Adb -Command @('logcat', '-c') | Out-Null
$null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
$offlinePath = "play-offline?artist=$encArtist&track=$encSingle&album=$encSingleAlbum"
$offlineOk = (Invoke-E2e $offlinePath 'SandboxE2E.*AREA=play-offline RESULT=PASS' 180)[0]
$offlineLog = Get-LogcatChunk
$onlineLeakKing = $offlineLog -match 'googlevideo|playArtistTrack|search-play'
Add-Result 'Locker play (KING offline)' ($offlineOk -and -not $onlineLeakKing) $(if ($onlineLeakKing) { 'leaked to online resolve' } elseif (-not $offlineOk) { 'play-offline failed' } else { 'content:// locker path' })

if ($offlineOk) {
    $hasContent = $offlineLog -match 'content://|nativeExoPlayUrl'
    $hasBlobFail = $offlineLog -match 'no locker audio blob|MEDIA_ELEMENT_ERROR.*blob:'
    Add-Result 'Locker native URI (KING)' ($hasContent -and -not $hasBlobFail) $(if ($hasBlobFail) { 'blob playback error' } elseif (-not $hasContent) { 'no content:// in log' } else { '' })
}

Write-Host '=== God Mode playlist (locker refs only) ===' -ForegroundColor Cyan
$godModeTracks = @(
    @{ Name = 'FRIED'; Artist = '¥$' },
    @{ Name = 'THE HERETIC ANTHEM'; Artist = 'Slipknot' }
)
foreach ($row in $godModeTracks) {
    $encPl = [uri]::EscapeDataString('God Mode')
    $encTrack = [uri]::EscapeDataString($row.Name)
    $encArtist = [uri]::EscapeDataString($row.Artist)
    $probePath = "probe-playlist-track?playlist=$encPl&track=$encTrack"
    $probeOk = (Invoke-E2e $probePath 'SandboxE2E.*AREA=probe-playlist-track' 45)[0]
    $probeLine = (Get-LogcatChunk | Select-String -Pattern 'SandboxE2E.*AREA=probe-playlist-track' | Select-Object -Last 1).Line
    $hasAudio = $probeLine -match 'playable=true'

    if (-not $hasAudio) {
        Write-Host "  -> No locker audio for $($row.Name); downloading via yt-dlp ..." -ForegroundColor Yellow
        Invoke-Adb -Command @('logcat', '-c') | Out-Null
        $dlPath = "download-track?artist=$encArtist&title=$encTrack&mode=tracks"
        $dlOk = (Invoke-E2e $dlPath 'SandboxE2E.*AREA=download-track RESULT=PASS' 900)[0]
        Add-Result "Playlist download: $($row.Name)" $dlOk $(if (-not $dlOk) { 'download failed' } else { '' })
        if ($dlOk) {
            Invoke-Adb -Command @('logcat', '-c') | Out-Null
            $probeOk = (Invoke-E2e $probePath 'SandboxE2E.*AREA=probe-playlist-track' 45)[0]
            $probeLine = (Get-LogcatChunk | Select-String -Pattern 'SandboxE2E.*AREA=probe-playlist-track' | Select-Object -Last 1).Line
            $hasAudio = $probeLine -match 'playable=true'
        }
    }

    Add-Result "Playlist probe: $($row.Name)" ($probeOk -and $hasAudio) $(if ($probeLine) { $probeLine } else { 'no probe log' })

    if ($hasAudio) {
        Invoke-Adb -Command @('logcat', '-c') | Out-Null
        $playPath = "play-playlist-track?playlist=$encPl&track=$encTrack"
        $playOk = (Invoke-E2e $playPath 'SandboxE2E.*AREA=play-playlist-track RESULT=PASS' 180)[0]
        $playLog = Get-LogcatChunk
        $onlineLeak = $playLog -match 'googlevideo|yt-dlp resolve|playArtistTrack'
        Add-Result "Playlist play: $($row.Name)" ($playOk -and -not $onlineLeak) $(if ($onlineLeak) { 'fell through to online resolve' } elseif (-not $playOk) { 'play failed' } else { 'offline playlist path' })
    } else {
        Add-Result "Playlist play: $($row.Name)" $false 'no locker audio after download'
    }
}

Write-Host '=== yt-dlp mobile probe ===' -ForegroundColor Cyan
$ytdlpOk = (Invoke-E2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 150)[0]
Add-Result 'yt-dlp mobile' $ytdlpOk

$encAlbum = [uri]::EscapeDataString($Album)
$encAlbumTrack = [uri]::EscapeDataString($AlbumTrack)

if ($IncludeOnline -and -not $QuickMode) {
    Write-Host '=== Online-only: playback scrub (NOT locker proof) ===' -ForegroundColor DarkYellow
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
    $scrubOk = (Invoke-E2e 'playback-scrub-stress?artist=Drake&track=Gods%20Plan' 'SandboxE2E.*AREA=playback-scrub-stress RESULT=PASS' 300)[0]
    Add-Result 'Online scrub stress' $scrubOk 'streaming path only'

    Write-Host '=== Online-only: search-play rotation ===' -ForegroundColor DarkYellow
    $queries = @('kanye west stronger', 'drake gods plan')
    $crashCount = 0
    foreach ($q in $queries) {
        Invoke-Adb -Command @('logcat', '-c') | Out-Null
        $enc = [uri]::EscapeDataString($q)
        Invoke-DeepLink "search-play?query=$enc"
        Start-Sleep -Seconds 35
        $fatal = Get-LogcatChunk | Select-String -Pattern 'FATAL EXCEPTION|ForegroundServiceDidNotStartInTime'
        if ($fatal) {
            $crashCount++
            Add-Result "Online search-play: $q" $false 'crash in logcat'
            break
        }
        $e2eFail = Get-LogcatChunk | Select-String -Pattern 'SandboxE2E.*RESULT=FAIL'
        Add-Result "Online search-play: $q" (-not $e2eFail) $(if ($e2eFail) { 'e2e fail' } else { '' })
    }
    Add-Result 'Online search-play crash-free' ($crashCount -eq 0) $(if ($crashCount) { "$crashCount crashes" } else { '' })
}

Write-Host '=== Stale blob guard (orphan locker id) ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
# Play a track that may exist in playlist metadata but lacks blob — should not spin/retry loop
$stalePath = 'play-offline?artist=Slipknot&track=THE%20HERETIC%20ANTHEM&album=All%20Hope%20Is%20Gone'
Invoke-DeepLink $stalePath
Start-Sleep -Seconds 15
$staleLog = Get-LogcatChunk
$retryLoop = @($staleLog | Select-String -Pattern 'useAudioFSM.*Failed.*retry|Connecting.*Connecting').Count -gt 3
$blobErr = $staleLog -match 'MEDIA_ELEMENT_ERROR.*blob:'
Add-Result 'Stale track no retry loop' (-not $retryLoop) $(if ($retryLoop) { 'retry loop detected' } else { '' })
Add-Result 'Stale track no blob WebView error' (-not $blobErr) $(if ($blobErr) { 'blob format error' } else { 'expected fail without blob is OK' })

& $Adb -s $Device logcat -d > $LogcatFile

$failCount = @($Results | Where-Object { $_.Result -ne 'PASS' }).Count
$ready = $failCount -eq 0

$report = @(
    '# Device Stress E2E Report',
    "Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "Device: $Device",
    '',
    '| Test | Result | Notes |',
    '|------|--------|-------|'
)
foreach ($r in $Results) {
    $report += "| $($r.Test) | $($r.Result) | $($r.Notes) |"
}
$report += ''
$report += "## Overall: $(if ($ready) { 'PASS' } else { 'FAIL' }) ($failCount failures)"
$text = $report -join "`n"
Set-Content -Path $ReportFile -Value $text -Encoding UTF8

Write-Host ''
Write-Host $text
Write-Host "Report: $ReportFile"
Write-Host "Logcat: $LogcatFile"

if (-not $ready) { exit 1 }
exit 0
