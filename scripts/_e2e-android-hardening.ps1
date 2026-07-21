# Dot-source after $EmuSerial, $Package, and optionally $EmulatorLockFile / $AvdName are set.
# b83d0086 E2E hardening: exclusive emulator, resilient APK install, MainActivity deep links.

function Get-E2eMainActivity {
    return "$Package/.MainActivity"
}

function Install-E2eApk {
    param(
        [Parameter(Mandatory = $true)][string]$ApkPath,
        [int]$TimeoutSec = 120
    )
    if (-not (Test-Path $ApkPath)) { throw "APK not found: $ApkPath" }
    Write-Host "Installing APK via adb install -r (${TimeoutSec}s cap) ..."
    $installArgs = @('-s', $EmuSerial, 'install', '-r', $ApkPath)
    $proc = Start-Process -FilePath 'adb.exe' -ArgumentList $installArgs -PassThru -NoNewWindow -Wait:$false
    $finished = $proc.WaitForExit($TimeoutSec * 1000)
    if ($finished -and $proc.ExitCode -eq 0) {
        Write-Host 'adb install -r: OK'
        return
    }
    if (-not $finished) {
        Write-Host 'adb install -r hung - killing and using push + pm install' -ForegroundColor Yellow
        try { $proc.Kill() } catch { }
        Start-Sleep -Seconds 2
    } else {
        Write-Host "adb install -r failed (exit $($proc.ExitCode)) - push + pm install" -ForegroundColor Yellow
    }
    $remote = '/data/local/tmp/sandboxmusic-e2e.apk'
    & adb.exe -s $EmuSerial push $ApkPath $remote
    if ($LASTEXITCODE -ne 0) { throw 'adb push failed' }
    & adb.exe -s $EmuSerial shell pm install -r -t $remote
    if ($LASTEXITCODE -ne 0) { throw 'pm install failed' }
    & adb.exe -s $EmuSerial shell rm -f $remote 2>$null | Out-Null
    Write-Host 'push + pm install: OK'
}

function Stop-CompetingAndroidE2e {
    $me = $PID
    $pattern = 'android-(snippet-gate|stream-continuity|vinyl-settings|download-cache|album-stability|network-playback|minimal-play|switch-stability).*e2e\.ps1'
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -match $pattern } |
        ForEach-Object {
            Write-Host "Stopping competing E2E powershell PID $($_.ProcessId)" -ForegroundColor Yellow
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessId -ne $me -and $_.CommandLine -match $pattern } |
        ForEach-Object {
            Write-Host "Stopping competing E2E pwsh PID $($_.ProcessId)" -ForegroundColor Yellow
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

function Clear-StaleE2eEmulatorLock {
    param([string]$LockFile)
    if (-not $LockFile -or -not (Test-Path $LockFile)) { return }
    $firstLine = (Get-Content -Path $LockFile -TotalCount 1 -ErrorAction SilentlyContinue)
    if ($firstLine -match '^(\d+)') {
        $lockPid = [int]$Matches[1]
        if ($lockPid -eq $PID) { return }
        if (-not (Get-Process -Id $lockPid -ErrorAction SilentlyContinue)) {
            Write-Host "Removing stale .e2e-emulator.lock (holder PID $lockPid gone)" -ForegroundColor Yellow
            Remove-Item -Force $LockFile -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host 'Removing unreadable stale .e2e-emulator.lock' -ForegroundColor Yellow
        Remove-Item -Force $LockFile -ErrorAction SilentlyContinue
    }
}

function Initialize-ExclusiveEmulatorE2e {
    param([switch]$ForceStopApp)
    Stop-CompetingAndroidE2e
    if ($EmulatorLockFile) { Clear-StaleE2eEmulatorLock $EmulatorLockFile }
    if ($ForceStopApp -and $Package) {
        & adb.exe -s $EmuSerial shell am force-stop $Package 2>$null | Out-Null
    }
}

function Start-E2eDeepLink {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$WaitStart
    )
    $adbSerial = if ($EmuSerial) { $EmuSerial } elseif ($Serial) { $Serial } else { $null }
    if (-not $adbSerial) { throw 'Start-E2eDeepLink: set $EmuSerial or $Serial before dot-sourcing _e2e-android-hardening.ps1' }
    $uri = 'sandboxmusic://e2e/' + $Path
    $activity = Get-E2eMainActivity
    $waitFlag = if ($WaitStart) { '-W ' } else { '' }
  # Quote URI for Android shell so query params with & are not split.
    $shellCmd = ('am start {0}-a android.intent.action.VIEW -d "{1}" -n {2} -f 0x14000000' -f $waitFlag, $uri, $activity)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & adb.exe -s $adbSerial shell $shellCmd 2>&1 | Out-Null
    } finally {
        $ErrorActionPreference = $prevEap
    }
    # am start often exits non-zero when the intent is delivered to the running activity.
}

# Play spine markers — accumulated during Wait-LogcatMatch so getStatus spam cannot scroll them out.
$script:PlaySpineSeen = @{
    handlePlayEnvelope = $false
    playUrl            = $false
    exoActive          = $false
}

function Reset-PlaySpineSeen {
    $script:PlaySpineSeen.handlePlayEnvelope = $false
    $script:PlaySpineSeen.playUrl = $false
    $script:PlaySpineSeen.exoActive = $false
}

function Clear-DeviceYtdlpPlaybackCache {
    $adbSerial = if ($EmuSerial) { $EmuSerial } elseif ($Serial) { $Serial } else { return $false }
    $pkg = if ($Package) { $Package } else { 'rd.sheepskin.sandboxmusic' }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $out = & adb.exe -s $adbSerial shell "run-as $pkg sh -c 'rm -rf cache/ytdlp-playback/* 2>/dev/null; ls cache/ytdlp-playback 2>/dev/null | wc -l'" 2>&1 | Out-String
        return ($out -match '^\s*0\s*$')
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Measure-FreshPlayTiming {
    param([string]$LogText, [string]$TrackName)
    $tapMs = $null
    $resolvedMs = $null
    $playUrlMs = $null
    $playingMs = $null
    $e2ePassMs = $null
    $hasUrl = $null
    $source = $null
    $ytdlpResolve = $false
    $playbackUrl = $null
    $trackTitleSeen = $false
    $resolveLagSec = $null
    $playLagSec = $null
    $totalLagSec = $null
    $nativeResolveMs = $null

    foreach ($line in ($LogText -split "`n")) {
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*handlePlayEnvelope\] timing (\{.*\})') {
            try {
                $payload = $Matches[2] | ConvertFrom-Json
                $phase = [string]$payload.phase
                $elapsed = [double]$payload.elapsedMs
                if ($phase -eq 'resolved' -and $null -eq $resolvedMs) {
                    $resolvedMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
                    $hasUrl = [bool]$payload.hasUrl
                    $source = [string]$payload.source
                }
                if ($phase -eq 'loadEnvelope-called' -and $null -eq $playUrlMs) {
                    $playUrlMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
                    $loadElapsedSec = $elapsed / 1000.0
                    if ($null -ne $resolveLagSec) {
                        $playLagSec = [Math]::Max(0, $loadElapsedSec - $resolveLagSec)
                    }
                    if ($null -eq $totalLagSec) { $totalLagSec = $loadElapsedSec }
                }
                if ($phase -eq 'resolved' -and $null -eq $resolveLagSec) {
                    $resolveLagSec = $elapsed / 1000.0
                }
            } catch { }
        }
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*handlePlayEnvelope\] tap') {
            $tapMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
        }
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*handlePlayEnvelope\] resolved (\{.*\})') {
            $resolvedMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
            try {
                $payload = $Matches[2] | ConvertFrom-Json
                $hasUrl = [bool]$payload.hasUrl
                $source = [string]$payload.source
            } catch { }
        }
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*methodName:\s*playUrl') {
            $playUrlMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
        }
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*AREA=artist-track-play RESULT=PASS') {
            $e2ePassMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
        }
        if ($line -match '(\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}).*"state":"playing"') {
            if (-not $playingMs) {
                $playingMs = [datetime]::ParseExact($Matches[1], 'MM-dd HH:mm:ss.fff', $null)
            }
        }
        if ($line -match 'YtDlpMobile.*resolve finished.*elapsedMs=(\d+)') {
            $ytdlpResolve = $true
            $nativeResolveMs = [int]$Matches[1]
        }
        if ($line -match '\[YtDlpMobile\] resolve ok' -or $line -match 'YtDlpMobile.*resolve') {
            $ytdlpResolve = $true
        }
        if ($line -match '"title":"([^"]*Ghost Town[^"]*)".*"currentUrl":"([^"]+)"') {
            $trackTitleSeen = $true
            $playbackUrl = $Matches[2]
        } elseif ($line -match '"currentUrl":"([^"]+)"' -and $line -match 'googlevideo|local/proxy|ytdlp-playback|videoplayback') {
            if (-not $playbackUrl) { $playbackUrl = $Matches[1] }
        }
    }

    if ($null -eq $resolveLagSec) {
        $resolveLagSec = if ($tapMs -and $resolvedMs) { ($resolvedMs - $tapMs).TotalSeconds } elseif ($tapMs -and $e2ePassMs) { ($e2ePassMs - $tapMs).TotalSeconds } else { $null }
    }
    if ($null -eq $playLagSec) {
        $playLagSec = if ($resolvedMs -and $playUrlMs) { ($playUrlMs - $resolvedMs).TotalSeconds } else { $null }
    }
    if ($null -eq $totalLagSec) {
        $totalLagSec = if ($tapMs -and $playingMs) { ($playingMs - $tapMs).TotalSeconds } elseif ($tapMs -and $e2ePassMs) { ($e2ePassMs - $tapMs).TotalSeconds } elseif ($resolveLagSec -and $playLagSec) { $resolveLagSec + $playLagSec } else { $null }
    }
    $cachedFatherHit = [bool]($playbackUrl -match 'HBMy-y2wb4I\.mp4')
    $streamKind = if ($playbackUrl -match 'HBMy-y2wb4I') { 'cached-father-file' }
        elseif ($playbackUrl -match 'ytdlp-playback') { 'ytdlp-file-cache' }
        elseif ($playbackUrl -match 'googlevideo|local/proxy') { 'googlevideo-stream' }
        elseif ($playbackUrl -match '^file://') { 'local-file' }
        else { 'unknown' }

    return [pscustomobject]@{
        resolveLagSec = $resolveLagSec
        playLagSec    = $playLagSec
        totalLagSec   = $totalLagSec
        nativeResolveMs = $nativeResolveMs
        hasUrl        = $hasUrl
        source        = $source
        ytdlpResolve  = $ytdlpResolve
        playbackUrl   = if ($playbackUrl) { $playbackUrl.Substring(0, [Math]::Min(120, $playbackUrl.Length)) } else { $null }
        streamKind    = $streamKind
        cachedFatherHit = $cachedFatherHit
        trackTitleSeen = $trackTitleSeen
        freshResolve  = ($ytdlpResolve -or $streamKind -eq 'googlevideo-stream') -and (-not $cachedFatherHit)
    }
}

function Update-PlaySpineSeen {
    param([string]$Chunk)
    if (-not $Chunk) { return }
    if ($Chunk -match '\[handlePlayEnvelope\]') { $script:PlaySpineSeen.handlePlayEnvelope = $true }
    if ($Chunk -match 'methodName:\s*playUrl') { $script:PlaySpineSeen.playUrl = $true }
    if ($Chunk -match '"state":"(playing|buffering)"') { $script:PlaySpineSeen.exoActive = $true }
}

function Get-PlaySpineLogcatChunk {
    param([int]$Tail = 8000)
    $adbSerial = if ($EmuSerial) { $EmuSerial } elseif ($Serial) { $Serial } else { return '' }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        return (& adb.exe -s $adbSerial logcat -d -s 'Capacitor/Console:I' 'Capacitor/Plugin:V' -t $Tail 2>$null | Out-String)
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Test-PlaySpineAccumulated {
    param([string]$Label = 'play-spine')
    Update-PlaySpineSeen (Get-PlaySpineLogcatChunk -Tail 12000)
    $checks = [ordered]@{
        handlePlayEnvelope = $script:PlaySpineSeen.handlePlayEnvelope
        playUrl            = $script:PlaySpineSeen.playUrl
        exoActive          = $script:PlaySpineSeen.exoActive
    }
    $pass = ($checks.Values | Where-Object { $_ -eq $false }).Count -eq 0
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    foreach ($kv in $checks.GetEnumerator()) {
        $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
        $color = if ($kv.Value) { 'Green' } else { 'Red' }
        Write-Host "$mark  $($kv.Key)" -ForegroundColor $color
    }
    return [pscustomobject]@{ Pass = $pass; Checks = $checks; Label = $Label }
}

# Physical-phone playback picks — never use over-tested Kanye cache magnets (FATHER, KING, etc.).
$script:PhoneBannedTracks = @('FATHER', 'KING', 'Follow God', 'Closed On Sunday')
$script:PhoneFreshTracks = @(
    @{ Artist = 'Tyler, The Creator'; Track = 'See You Again (feat. Kali Uchis)' },
    @{ Artist = 'Radiohead'; Track = 'Everything In Its Right Place' },
    @{ Artist = 'JPEGMAFIA'; Track = 'PRONE!' },
    @{ Artist = 'Kanye West'; Track = 'Devil In A New Dress' },
    @{ Artist = 'Frank Ocean'; Track = 'Pink + White' },
    @{ Artist = 'Kanye West'; Track = 'Ghost Town (feat. PARTYNEXTDOOR)' },
    @{ Artist = 'Billie Eilish'; Track = 'when the party''s over' },
    @{ Artist = 'Cigarettes After Sex'; Track = 'Apocalypse' },
    @{ Artist = 'Bon Iver'; Track = 'Holocene' },
    @{ Artist = 'Arctic Monkeys'; Track = 'Do I Wanna Know?' },
    @{ Artist = 'Kendrick Lamar'; Track = 'HUMBLE.' },
    @{ Artist = 'Denzel Curry'; Track = 'Ultimate' },
    @{ Artist = 'SZA'; Track = 'Kill Bill' }
)

function Get-PhoneFreshTrack {
    param(
        [string]$Artist = '',
        [string]$Track = ''
    )
    if ($Artist -and $Track) {
        if ($script:PhoneBannedTracks -contains $Track) {
            throw "Track '$Track' is banned from phone E2E (cached shortcut magnet). Pick from PhoneFreshTracks."
        }
        return [pscustomobject]@{ Artist = $Artist; Track = $Track }
    }
    $pool = $script:PhoneFreshTracks | Where-Object { $script:PhoneBannedTracks -notcontains $_.Track }
    if (-not $pool -or $pool.Count -eq 0) {
        throw 'PhoneFreshTracks pool is empty after banned-track filter'
    }
    return ($pool | Get-Random)
}

function Invoke-PhonePlaybackCacheClear {
    param([int]$SettleSec = 8)
    Start-E2eDeepLink -Path 'clear-server'
    Start-E2eDeepLink -Path 'clear-playback-caches'
    Start-E2eDeepLink -Path 'check-ytdlp'
    Start-Sleep -Seconds $SettleSec
    $cleared = Clear-DeviceYtdlpPlaybackCache
    return $cleared
}

function Assert-PhoneFreshPlayback {
    param(
        [string]$LogText,
        [string]$Label = 'playback',
        [switch]$AllowCache
    )
    $timing = Measure-FreshPlayTiming -LogText $LogText
    if ($timing.cachedFatherHit -and -not $AllowCache) {
        throw "cached FATHER file hit during $Label (HBMy-y2wb4I) - not a fresh resolve"
    }
    if ($timing.streamKind -eq 'cached-father-file' -and -not $AllowCache) {
        throw "stream kind cached-father-file during $Label - not a fresh resolve"
    }
    return $timing
}

function Write-PhoneFreshTiming {
    param($Timing, [string]$Track, [string]$Artist)
    Write-Host "track: $Artist - $Track" -ForegroundColor Cyan
    if ($null -ne $Timing.resolveLagSec) {
        Write-Host ("tap→resolved: {0:N1}s | resolved→Exo: {1:N1}s | tap→load: {2:N1}s" -f $Timing.resolveLagSec, $(if ($Timing.playLagSec) { $Timing.playLagSec } else { 0 }), $(if ($Timing.totalLagSec) { $Timing.totalLagSec } else { 0 }))
    }
    if ($Timing.nativeResolveMs) { Write-Host "native yt-dlp resolve: $($Timing.nativeResolveMs)ms" }
    if ($Timing.streamKind) { Write-Host "stream kind: $($Timing.streamKind)" }
    if ($Timing.playbackUrl) { Write-Host "playback url: $($Timing.playbackUrl)" }
    Write-Host ("fresh resolve: " + $(if ($Timing.freshResolve) { 'yes' } else { 'NO (cache shortcut?)' }))
}
