# Locked-screen stress — full locker album (10+ tracks) + long playlist/radio with screen off.
# Physical device only. No uninstall/pm clear.
param(
    [string]$Serial = '46349770',
    [string]$Artist = '21 Savage',
    [string]$Album = 'american dream',
    [int]$MinTracks = 10,
    [int]$MinPlaylistTracks = 20,
    [int]$PocketMinutes = 15,
    [switch]$SkipBuild,
    [switch]$SkipInstall,
    [switch]$AlbumOnly,
    [switch]$PlaylistOnly
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.locked-screen-album-stress-report.json'
$LogPath = Join-Path $Root '.locked-screen-album-stress-logcat.txt'
$Adb = 'adb.exe'

function Get-Log {
    param([int]$Tail = 30000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { return (& $Adb -s $Serial logcat -d -t $Tail 2>$null | Out-String) }
    finally { $ErrorActionPreference = $prev }
}

function Wait-Match {
    param([string]$Pattern, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-Log
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') { throw 'App crash during locked-screen stress' }
        if ($chunk -match $Pattern) { return $true, $Matches[0].Trim() }
        Start-Sleep -Seconds 2
    }
    return $false, 'timeout'
}

function Parse-Transitions {
    param([string]$LogText)
    $rows = @()
    foreach ($m in [regex]::Matches($LogText, 'mediaItemTransition[^\n]*|NativeExoPlayback.*mediaItemTransition[^\n]*|playbackEvent.*mediaItemTransition[^\n]*')) {
        $line = $m.Value
        $idx = if ($line -match '"index"\s*:\s*(\d+)') { [int]$Matches[1] } elseif ($line -match 'index[=:](\d+)') { [int]$Matches[1] } else { $null }
        $qlen = if ($line -match '"queueLength"\s*:\s*(\d+)') { [int]$Matches[1] } elseif ($line -match 'queueLength[=:](\d+)') { [int]$Matches[1] } else { $null }
        $title = if ($line -match 'title[=:]([^,\n}]+)') { $Matches[1].Trim() } else { $null }
        $rows += [ordered]@{ line = $line.Trim(); index = $idx; queueLength = $qlen; title = $title }
    }
    return $rows
}

function Parse-MetaTitles {
    param([string]$LogText)
    $titles = @()
    foreach ($m in [regex]::Matches($LogText, 'MediaPlaybackFGS.*metadata rev=\d+[^\n]*title=([^\n]+)')) {
        $t = $m.Groups[1].Value.Trim()
        if ($t -and ($titles.Count -eq 0 -or $titles[-1] -ne $t)) { $titles += $t }
    }
    foreach ($m in [regex]::Matches($LogText, 'SandboxE2E.*AREA=playback-probe[^\n]*title=([^ ]+)')) {
        $t = $m.Groups[1].Value.Trim()
        if ($t -and ($titles.Count -eq 0 -or $titles[-1] -ne $t)) { $titles += $t }
    }
    return $titles
}

function Get-LatestNativeStatus {
    param([string]$LogText)
    $lastQ = 0
    $lastP = 0
    foreach ($m in [regex]::Matches($LogText, '"queueLength"\s*:\s*(\d+)')) {
        $lastQ = [int]$m.Groups[1].Value
    }
    foreach ($m in [regex]::Matches($LogText, '"positionSecs"\s*:\s*(\d+(?:\.\d+)?)')) {
        $lastP = [double]$m.Groups[1].Value
    }
    return @{ queueLength = $lastQ; positionSecs = $lastP }
}

function Wait-QueuePrimed {
    param([int]$MinQueueLength, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        Start-E2eDeepLink -Path 'probe-playback' 2>$null | Out-Null
        Start-Sleep -Seconds 2
        $log = Get-Log -Tail 12000
        $status = Get-LatestNativeStatus $log
        if ($status.queueLength -ge $MinQueueLength) { return $status.queueLength }
        Start-Sleep -Seconds 3
    }
    return (Get-LatestNativeStatus (Get-Log -Tail 12000)).queueLength
}

function Monitor-LockedTransitions {
    param(
        [string]$Label,
        [string[]]$ExpectedOrder,
        [int]$MinDistinct,
        [int]$MaxWaitSec = 3600
    )
    $lockStart = Get-Date
    $deadline = $lockStart.AddSeconds($MaxWaitSec)
    $seenMeta = [System.Collections.Generic.List[string]]::new()
    $seenTransitions = @()
    $transitionLog = @()

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 8
        $chunk = Get-Log -Tail 50000
        foreach ($t in (Parse-MetaTitles $chunk)) {
            if ($seenMeta.Count -eq 0 -or $seenMeta[$seenMeta.Count - 1] -ne $t) {
                $seenMeta.Add($t) | Out-Null
                $transitionLog += [ordered]@{
                    atSec = [int]((Get-Date) - $lockStart).TotalSeconds
                    source = 'metadata'
                    title = $t
                    locked = $true
                }
                Write-Host ("  [$Label locked] metadata: " + $t) -ForegroundColor DarkCyan
            }
        }
        foreach ($tr in (Parse-Transitions $chunk)) {
            $key = "$($tr.index)-$($tr.queueLength)-$($tr.title)"
            if ($seenTransitions -notcontains $key) {
                $seenTransitions += $key
                $transitionLog += [ordered]@{
                    atSec = [int]((Get-Date) - $lockStart).TotalSeconds
                    source = 'mediaItemTransition'
                    index = $tr.index
                    queueLength = $tr.queueLength
                    title = $tr.title
                    locked = $true
                }
                Write-Host ("  [$Label locked] transition idx=" + $tr.index + ' qlen=' + $tr.queueLength + ' title=' + $tr.title) -ForegroundColor Magenta
            }
        }
        if ($seenMeta.Count -ge $MinDistinct) {
            Write-Host "[$Label] Reached $MinDistinct+ distinct titles while locked" -ForegroundColor Green
            break
        }
        $elapsed = [int]((Get-Date) - $lockStart).TotalSeconds
        if ($elapsed -gt 600 -and $seenMeta.Count -lt $MinDistinct) {
            Write-Host ("[$Label] Still waiting at ${elapsed}s with $($seenMeta.Count) title(s)") -ForegroundColor Yellow
        }
    }

    $orderOk = $true
    $compareCount = [Math]::Min($ExpectedOrder.Count, $seenMeta.Count)
    for ($i = 0; $i -lt $compareCount; $i++) {
        $exp = $ExpectedOrder[$i].ToLower()
        $got = $seenMeta[$i].ToLower()
        if ($got -notlike "*$exp*" -and $exp -notlike "*$got*") { $orderOk = $false; break }
    }

    return [ordered]@{
        label = $Label
        distinctWhileLocked = @($seenMeta)
        transitionsWhileLocked = $seenTransitions
        transitionLog = $transitionLog
        orderOk = $orderOk
        lockedSeconds = [int]((Get-Date) - $lockStart).TotalSeconds
        pass = ($seenMeta.Count -ge $MinDistinct) -and $orderOk
    }
}

function Bootstrap-E2e {
    Start-E2eDeepLink -Path 'skip-onboarding'
    $null = Wait-Match 'AREA=onboarding RESULT=PASS' 90
    $vaultDeadline = (Get-Date).AddSeconds(180)
    while ((Get-Date) -lt $vaultDeadline) {
        $chunk = Get-Log -Tail 15000
        if ($chunk -match '\[locker\] warmed native playback cache' -or $chunk -match 'AREA=bridge RESULT=PASS') { break }
        Start-Sleep -Seconds 4
    }
    Start-E2eDeepLink -Path 'probe-handlers'
    $null = Wait-Match 'AREA=handlers-probe RESULT=PASS' 90
    Start-E2eDeepLink -Path 'clear-server'
    $null = Wait-Match 'AREA=server-url RESULT=PASS' 30
    Start-E2eDeepLink -Path 'reset-playback'
    $null = Wait-Match 'AREA=reset-playback RESULT=PASS' 30
}

if ((& $Adb -s $Serial get-state 2>&1) -ne 'device') { throw "Device $Serial not ready" }

if (-not $SkipBuild) {
    Write-Host 'Building APK...' -ForegroundColor Cyan
    npm run build:android:apk | Out-Null
}
$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }

if (-not $SkipInstall) {
    Install-E2eApk -ApkPath $apk
}
$installLine = (& $Adb -s $Serial shell "dumpsys package $Package | grep lastUpdateTime" 2>$null | Select-Object -First 1).Trim()

& $Adb -s $Serial logcat -c | Out-Null
& $Adb -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
& $Adb -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 12
Bootstrap-E2e

$encA = [uri]::EscapeDataString($Artist)
$encAl = [uri]::EscapeDataString($Album)
$results = @()

# --- Test 1: Full locker album, screen locked before track 2 ---
if (-not $PlaylistOnly) {
    Write-Host "`n=== TEST 1: LOCKER ALBUM ($MinTracks+ tracks) ===" -ForegroundColor Cyan
    Start-E2eDeepLink -Path "verify-locker-album?artist=$encA&album=$encAl"
    $albumOk, $albumLine = Wait-Match 'AREA=verify-locker-album RESULT=PASS' 60
    Write-Host "Locker album verify: $albumLine"

    Start-E2eDeepLink -Path "open-album?artist=$encA&album=$encAl"
    $null = Wait-Match 'AREA=open-album RESULT=PASS' 120
    Start-E2eDeepLink -Path 'list-album-tracks'
    $listOk, $listLine = Wait-Match 'AREA=album-tracks RESULT=PASS' 30
    $expectedTracks = @()
    if ($listLine -match 'tracks=([^ ]+)') {
        $expectedTracks = $Matches[1] -split '\|' | Where-Object { $_ }
    }
    if ($expectedTracks.Count -lt $MinTracks) {
        $expectedTracks = @(
            'Redrum', 'All Of Me', 'Sneaky', 'N.h.i.e.', 'Red Opps', 'Dangerous',
            'Dark Days', 'Paperwork', 'Just Like Me', 'Ocean Eyes', 'Smokers Anthem',
            'Redrum (Remix)', 'Shoulda Ran', 'Prove It'
        )
    }
    $playTracks = $expectedTracks | Select-Object -First ([Math]::Max($MinTracks, $expectedTracks.Count))
    $firstTrack = $playTracks[0]
    $encT = [uri]::EscapeDataString($firstTrack)
    Write-Host "Album queue ($($playTracks.Count) tracks): $($playTracks -join ' | ')"

    & $Adb -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
    $playOk, $playLine = Wait-Match 'AREA=play-offline RESULT=PASS' 300
    if (-not $playOk) { throw "Failed to start album playback: $playLine" }

    $targetQueue = [Math]::Min($playTracks.Count, [Math]::Max($MinTracks, 10))
    $primedQ = Wait-QueuePrimed -MinQueueLength $targetQueue -TimeoutSec 180
    Write-Host "Native queue primed: queueLength=$primedQ (target $targetQueue)" -ForegroundColor Yellow

    Start-Sleep -Seconds 20
    $preLockLog = Get-Log -Tail 8000
    $preStatus = Get-LatestNativeStatus $preLockLog
    $posBeforeLock = $preStatus.positionSecs
    $queueBeforeLock = $preStatus.queueLength
    Write-Host ("Pre-lock: pos=$posBeforeLock queueLength=$queueBeforeLock - locking NOW") -ForegroundColor Yellow
    & $Adb -s $Serial shell input keyevent KEYCODE_POWER | Out-Null

    $albumMonitor = Monitor-LockedTransitions -Label 'album' -ExpectedOrder $playTracks -MinDistinct $MinTracks -MaxWaitSec 2800
    $albumMonitor.queueLengthBeforeLock = $queueBeforeLock
    $albumMonitor.positionBeforeLock = $posBeforeLock
    $albumMonitor.queuePrimed = $primedQ
    $albumMonitor.expectedTracks = $playTracks
    $results += $albumMonitor

    & $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
    Start-Sleep -Seconds 2
    Start-E2eDeepLink -Path 'stop-exo'
    Start-Sleep -Seconds 2
}

# --- Test 2: Long playlist / track radio (20+ tracks), locked early ---
if (-not $AlbumOnly) {
    Write-Host "`n=== TEST 2: LONG PLAYLIST / TRACK RADIO ===" -ForegroundColor Cyan
    Bootstrap-E2e
    $encSingle = [uri]::EscapeDataString('Sked')
    & $Adb -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encSingle"
    $radioPlayOk, $radioPlayLine = Wait-Match 'AREA=play-offline RESULT=PASS' 180
    if (-not $radioPlayOk) { throw "Failed to start track radio seed: $radioPlayLine" }
    Start-Sleep -Seconds 12
    $radioOk, $radioLine = Wait-Match 'AREA=probe-track-radio RESULT=PASS' 60
    $radioTrackCount = 0
    if ($radioLine -match 'tracks=(\d+)') { $radioTrackCount = [int]$Matches[1] }
    Write-Host "Track radio playlist: $radioLine"

    $primedRadioQ = Wait-QueuePrimed -MinQueueLength ([Math]::Min(10, $radioTrackCount)) -TimeoutSec 120
    Write-Host "Native radio queue primed: queueLength=$primedRadioQ" -ForegroundColor Yellow

    Start-Sleep -Seconds 15
    & $Adb -s $Serial shell input keyevent KEYCODE_POWER | Out-Null
    $radioMinDistinct = [Math]::Min($MinTracks, [Math]::Max(10, [Math]::Floor($radioTrackCount / 2)))
    if ($radioTrackCount -ge $MinPlaylistTracks) { $radioMinDistinct = $MinTracks }
    $radioMonitor = Monitor-LockedTransitions -Label 'radio' -ExpectedOrder @() -MinDistinct $radioMinDistinct -MaxWaitSec 2400
    $radioMonitor.radioTrackCount = $radioTrackCount
    $radioMonitor.queuePrimed = $primedRadioQ
    $radioMonitor.pass = $radioPlayOk -and $radioOk -and ($radioMonitor.distinctWhileLocked.Count -ge $radioMinDistinct)
    $results += $radioMonitor

    & $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
    Start-Sleep -Seconds 2
}

# --- Test 3: Pocket duration (15+ min locked) — reuse album if long enough ---
if (-not $PlaylistOnly -and $PocketMinutes -gt 0) {
    Write-Host "`n=== TEST 3: POCKET DURATION ($PocketMinutes+ min) ===" -ForegroundColor Cyan
    Bootstrap-E2e
    $encT = [uri]::EscapeDataString('Redrum')
    & $Adb -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
    $null = Wait-Match 'AREA=play-offline RESULT=PASS' 180
    $null = Wait-QueuePrimed -MinQueueLength 10 -TimeoutSec 120
    Start-Sleep -Seconds 15
    & $Adb -s $Serial shell input keyevent KEYCODE_POWER | Out-Null
    $pocketStart = Get-Date
    $pocketDeadline = $pocketStart.AddMinutes($PocketMinutes)
    $pocketTitles = [System.Collections.Generic.List[string]]::new()
    $lastTitle = ''
    while ((Get-Date) -lt $pocketDeadline) {
        Start-Sleep -Seconds 30
        $chunk = Get-Log -Tail 30000
        foreach ($t in (Parse-MetaTitles $chunk)) {
            if ($pocketTitles.Count -eq 0 -or $pocketTitles[$pocketTitles.Count - 1] -ne $t) {
                $pocketTitles.Add($t) | Out-Null
                $lastTitle = $t
                Write-Host ("  [pocket] +" + [int]((Get-Date) - $pocketStart).TotalMinutes + "m title: " + $t) -ForegroundColor DarkGreen
            }
        }
        $elapsedMin = [int]((Get-Date) - $pocketStart).TotalMinutes
        if ($elapsedMin -gt 0 -and $elapsedMin % 5 -eq 0) {
            Write-Host "  [pocket] $elapsedMin / $PocketMinutes min, $($pocketTitles.Count) titles" -ForegroundColor DarkGray
        }
    }
    $pocketLockedSec = [int]((Get-Date) - $pocketStart).TotalSeconds
    $pocketPass = ($pocketTitles.Count -ge 3) -and ($pocketLockedSec -ge ($PocketMinutes * 60 - 60))
    $results += [ordered]@{
        label = 'pocket'
        pass = $pocketPass
        lockedSeconds = $pocketLockedSec
        distinctWhileLocked = @($pocketTitles)
        targetMinutes = $PocketMinutes
        lastTitle = $lastTitle
    }
    & $Adb -s $Serial shell input keyevent KEYCODE_WAKEUP | Out-Null
}

# Cleanup
Start-E2eDeepLink -Path 'stop-exo'
Start-Sleep -Seconds 2
& $Adb -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& $Adb -s $Serial shell am start -n "$Package/.MainActivity" | Out-Null

$fullLog = Get-Log -Tail 100000
$fullLog | Set-Content -Path $LogPath -Encoding UTF8

$overallPass = ($results | Where-Object { $_.pass }).Count -eq $results.Count -and $results.Count -gt 0
$report = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    install = $installLine
    artist = $Artist
    album = $Album
    minTracks = $MinTracks
    minPlaylistTracks = $MinPlaylistTracks
    pocketMinutes = $PocketMinutes
    results = $results
    pass = $overallPass
    verdict = if ($overallPass) { 'PASS' } else { 'FAIL' }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host "`n=== LOCKED-SCREEN STRESS (REALISTIC SCALE) ===" -ForegroundColor Cyan
Write-Host "Verdict: $($report.verdict)" -ForegroundColor $(if ($overallPass) { 'Green' } else { 'Red' })
foreach ($r in $results) {
    $c = if ($r.pass) { 'Green' } else { 'Red' }
    $distinct = @($r.distinctWhileLocked).Count
    Write-Host ("  {0}: {1} - {2} titles, {3}s locked" -f $r.label, $(if ($r.pass) { 'PASS' } else { 'FAIL' }), $distinct, $r.lockedSeconds) -ForegroundColor $c
    if ($r.expectedTracks) {
        for ($i = 0; $i -lt [Math]::Min($r.expectedTracks.Count, $distinct); $i++) {
            $exp = $r.expectedTracks[$i]
            $got = if ($i -lt $distinct) { $r.distinctWhileLocked[$i] } else { '(missing)' }
            Write-Host ("    #{0} expected={1} played={2}" -f ($i + 1), $exp, $got)
        }
    }
}
Write-Host "Report: $ReportPath"
Write-Host "Logcat: $LogPath"

if (-not $overallPass) { exit 1 }
exit 0
