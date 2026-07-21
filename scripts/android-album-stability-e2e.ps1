# Sandbox Music — dual-mode album + singles E2E (Android emulator ONLY)
# Usage: .\scripts\android-album-stability-e2e.ps1
#        .\scripts\android-album-stability-e2e.ps1 -SwitchStabilityOnly
# NEVER installs to physical devices — emulator-5554 only.

param(
    [switch]$SwitchStabilityOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"

$AvdName = 'SandboxMusic_API36_x86_64'
$EmuSerial = 'emulator-5554'
$ForbiddenSerial = '46349770'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$Artist = 'Kanye West'
$Albums = @(
    @{ Name = 'Bully'; ExpectedTracks = 18 }
    @{ Name = 'Jesus Is King'; ExpectedTracks = 11 }
)
$Singles = @(
    @{ Artist = 'Kanye West'; Track = 'FATHER' }
    @{ Artist = 'Kanye West'; Track = 'Follow God' }
    @{ Artist = 'Kanye West'; Track = 'Closed On Sunday' }
)
$Modes = @('album-cover', 'vinyl-shades')
$LogcatFile = Join-Path $Root '.album-stability-logcat.txt'
$ReportFile = Join-Path $Root '.album-stability-report.txt'
$SwitchReportFile = Join-Path $Root '.switch-stability-report.txt'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'
$ProgressSecs = 12
$PlayTimeoutSec = 1200
if ($SwitchStabilityOnly) {
    $LogcatFile = Join-Path $Root '.switch-stability-logcat.txt'
}

function Invoke-Adb {
    param([string[]]$Command)
    if (-not $Command -or $Command.Count -eq 0) { throw 'Invoke-Adb requires arguments' }
    Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command
    & adb.exe -s $EmuSerial @Command
    if ($LASTEXITCODE -ne 0) {
        throw ("adb failed: adb.exe " + ($Command -join ' '))
    }
}

function Test-AdbDeviceOnline {
    param([string]$Serial)
    $devices = (& adb devices 2>$null) -join "`n"
    return ($devices -match "${Serial}\s+device")
}

function Assert-EmulatorOnly {
    if (-not (Test-AdbDeviceOnline $EmuSerial)) {
        throw "Emulator $EmuSerial not ready. Start $AvdName first."
    }
    $devices = (& adb devices 2>$null) -join "`n"
    if ($devices -match "${ForbiddenSerial}\s+device") {
        Write-Host "WARNING: Physical phone $ForbiddenSerial connected - will install ONLY to $EmuSerial" -ForegroundColor Yellow
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

function Start-EmulatorIfNeeded {
    if (Test-AdbDeviceOnline $EmuSerial) {
        Write-Host "Emulator already running ($EmuSerial)"
        return
    }
    Write-Host "Starting emulator $AvdName ..."
    Start-Process -FilePath 'emulator' -ArgumentList @('-avd', $AvdName, '-port', '5554', '-no-snapshot-save', '-gpu', 'swiftshader_indirect') -WindowStyle Minimized | Out-Null
    if (-not (Wait-EmulatorBoot)) { throw 'Emulator boot timeout' }
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    & adb.exe -s $EmuSerial shell "am start -a android.intent.action.VIEW -d '$uri' $Package" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw ("adb deep link failed: $uri")
    }
}

function Get-LogcatChunk {
    param([int]$Tail = 12000)
    $out = & adb.exe -s $EmuSerial logcat -d -t $Tail 2>$null
    if ($null -eq $out) { return '' }
    if ($out -is [string]) { return $out }
    return ($out -join "`n")
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
        [int]$TimeoutSec = 120,
        [switch]$AllowFail
    )
    Invoke-DeepLink $Path
    Start-Sleep -Seconds 3
    if (-not $WaitPattern) { return $true, '' }
    $ok, $line = Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
    if (-not $ok -and -not $AllowFail) {
        Write-Host "E2E timeout: $Path (pattern=$WaitPattern)" -ForegroundColor Yellow
    }
    return $ok, $line
}

function Get-LogcatLines {
    param([string]$Pattern)
    $chunk = Get-LogcatChunk -Tail 16000
    return @([regex]::Matches($chunk, $Pattern) | ForEach-Object { $_.Value })
}

function Normalize-Title([string]$Title) {
    return ($Title -replace '\s+', ' ').Trim().ToLower()
}

function Titles-Match([string]$A, [string]$B) {
    return (Normalize-Title $A) -eq (Normalize-Title $B)
}

function Get-RegexGroup {
    param([string]$Text, [string]$Pattern, [int]$Group = 1)
    if (-not $Text) { return '' }
    $m = [regex]::Match($Text, $Pattern)
    if ($m.Success) { return $m.Groups[$Group].Value }
    return ''
}

function Parse-AlbumTracksFromLine {
    param([string]$Line)
    if (-not $Line) { return @() }
    $m = [regex]::Match($Line, 'tracks=([^|\r\n]+(?:\|[^|\r\n]+)*)')
    if ($m.Success) {
        return @($m.Groups[1].Value.Split('|') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    return @()
}

function Parse-AlbumTracksFromLogcat {
    $lines = @(Get-LogcatLines 'SandboxE2E.*AREA=album-tracks RESULT=PASS count=\d+ tracks=')
    if ($lines.Count -eq 0) { return @() }
    return @(Parse-AlbumTracksFromLine $lines[-1])
}

function Set-VinylMode {
    param([string]$Mode)
    $null = Invoke-E2e "set-vinyl-mode?mode=$Mode" "SandboxE2E.*AREA=vinyl-mode-set RESULT=PASS mode=$Mode" 20
    $probeOk = (Invoke-E2e "probe-vinyl?mode=$Mode" "SandboxE2E.*AREA=vinyl-mode RESULT=PASS mode=$Mode" 15)[0]
    return $probeOk
}

function Test-TrackPlayback {
    param(
        [string]$Kind,
        [string]$Artist,
        [string]$Album,
        [string]$Track,
        [string]$Mode,
        [int]$ProgressSecs = 12
    )
    $result = [ordered]@{
        Track      = $Track
        Album      = $Album
        Kind       = $Kind
        Mode       = $Mode
        NowPlaying = ''
        ArtOk      = '?'
        Play       = 'FAIL'
        Progress   = 'FAIL'
        Notes      = ''
    }

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    if (-not (Set-VinylMode $Mode)) {
        $result.Notes = 'vinyl-mode-set FAIL'
        return $result
    }

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    if ($Kind -eq 'album') {
        $encAlbum = [uri]::EscapeDataString($Album)
        $playPath = "play-album-track?artist=$encArtist" + '&album=' + $encAlbum + '&track=' + $encTrack
        $playPattern = 'SandboxE2E.*AREA=album-track-play RESULT=PASS'
        $playFailArea = 'album-track-play'
    } else {
        $playPath = "play-artist-track?artist=$encArtist" + '&track=' + $encTrack
        $playPattern = 'SandboxE2E.*AREA=artist-track-play RESULT=PASS'
        $playFailArea = 'artist-track-play'
    }

    $playOk = (Invoke-E2e $playPath $playPattern $PlayTimeoutSec)[0]
    $playLine = (Get-LogcatLines "SandboxE2E.*AREA=$playFailArea RESULT=(PASS|FAIL)")[-1]
    $result.NowPlaying = Get-RegexGroup $playLine 'actual=([^ ]+)'

    if (-not $playOk) {
        $result.Notes = "$playFailArea FAIL"
        if ($result.NowPlaying -and -not (Titles-Match $result.NowPlaying $Track)) {
            $result.Notes += " WRONG-TRACK: expected=$Track got=$($result.NowPlaying)"
        }
        return $result
    }

    if ($result.NowPlaying -and -not (Titles-Match $result.NowPlaying $Track)) {
        $result.Notes = "WRONG-TRACK: expected=$Track got=$($result.NowPlaying)"
        return $result
    }

    $result.Play = 'PASS'

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $probeOk = (Invoke-E2e 'probe-playback' 'SandboxE2E.*AREA=playback-probe RESULT=PASS' 30)[0]
    $probeLine = (Get-LogcatLines 'SandboxE2E.*AREA=playback-probe RESULT=PASS')[-1]
    $probeTitle = Get-RegexGroup $probeLine 'title=([^ ]+)'
    if ($probeTitle) { $result.NowPlaying = $probeTitle }
    if ($probeOk) { $result.ArtOk = 'PASS' }

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $progMatched = (Invoke-E2e "wait-progress?seconds=$ProgressSecs" 'SandboxE2E.*AREA=playback-progress RESULT=PASS' ($ProgressSecs + 75))[0]
    $progLine = (Get-LogcatLines 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')[-1]
    if ($progMatched) {
        $result.Progress = 'PASS'
    } else {
        $advStr = Get-RegexGroup $progLine 'advance=([\d.]+)s'
        if ($advStr) {
            $adv = [double]$advStr
            if ($adv -ge 5) {
                $result.Progress = 'PARTIAL'
                $result.Notes += " advance=${adv}s"
            } else {
                $result.Notes += ' progress-stuck'
            }
        } else {
            $result.Notes += ' progress-timeout'
        }
    }

    Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20 | Out-Null
    Start-Sleep -Seconds 2
    return $result
}

function Wait-AppReady {
    param([int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk -Tail 3000
        if ($chunk -match 'Loading app at https://localhost' -or $chunk -match 'App started') {
            Start-Sleep -Seconds 10
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-Host 'App ready wait timed out — continuing with fixed delay' -ForegroundColor Yellow
    Start-Sleep -Seconds 15
    return $false
}
function Wait-EmulatorE2eLock {
    param([int]$MaxWaitSec = 900)
    if (-not (Test-Path $EmulatorLockFile)) { return }
    $deadline = (Get-Date).AddSeconds($MaxWaitSec)
    while ((Test-Path $EmulatorLockFile) -and (Get-Date) -lt $deadline) {
        Write-Host "Emulator E2E lock present ($EmulatorLockFile) - waiting 30s ..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
    if (Test-Path $EmulatorLockFile) {
        throw "Emulator E2E lock still held after ${MaxWaitSec}s"
    }
}

function Test-VinylToggle {
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    $coverOk = (Invoke-E2e 'set-vinyl-mode?mode=album-cover' 'SandboxE2E.*AREA=vinyl-mode-set RESULT=PASS mode=album-cover' 20)[0]
    $toVinylOk = (Invoke-E2e 'toggle-vinyl' 'SandboxE2E.*AREA=vinyl-toggle RESULT=PASS mode=vinyl-shades' 20)[0]
    $toCoverOk = (Invoke-E2e 'toggle-vinyl' 'SandboxE2E.*AREA=vinyl-toggle RESULT=PASS mode=album-cover' 20)[0]
    return ($coverOk -and $toVinylOk -and $toCoverOk)
}

function Test-SwitchStability {
    param(
        [string]$Artist = 'Kanye West',
        [string]$Track = 'Follow God'
    )
    $cases = [System.Collections.Generic.List[object]]::new()

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 45
    Start-Sleep -Seconds 2

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    $playPath = "play-artist-track?artist=$encArtist" + '&track=' + $encTrack
    $playOk = (Invoke-E2e $playPath 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' $PlayTimeoutSec)[0]
    if (-not $playOk) {
        $cases.Add([pscustomobject]@{ Case = 'setup-play'; Result = 'FAIL'; Notes = 'artist-track-play failed' })
        return $cases, $false
    }
    Start-Sleep -Seconds 3

  Write-Host '  [1/5] Rapid toggle album/vinyl ...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Set-VinylMode 'album-cover'
    $amp = [char]38
    $rapidPath = "rapid-toggle-vinyl?count=8${amp}final=vinyl-shades"
    $rapidOk = (Invoke-E2e $rapidPath 'SandboxE2E.*AREA=rapid-toggle-vinyl RESULT=PASS' 90)[0]
    $cases.Add([pscustomobject]@{ Case = 'rapid-toggle'; Result = $(if ($rapidOk) { 'PASS' } else { 'FAIL' }); Notes = '' })

  Write-Host '  [2/5] Toggle mid-playback ...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $midOk = (Invoke-E2e 'toggle-vinyl-mid-play' 'SandboxE2E.*AREA=toggle-mid-play RESULT=PASS' 30)[0]
    $cases.Add([pscustomobject]@{ Case = 'toggle-mid-play'; Result = $(if ($midOk) { 'PASS' } else { 'FAIL' }); Notes = '' })

  Write-Host '  [3/5] Expand/collapse respects poster mode ...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Set-VinylMode 'album-cover'
    Start-Sleep -Seconds 1
    $expandOk = (Invoke-E2e 'expand-now-playing' 'SandboxE2E.*AREA=expand-now-playing RESULT=PASS' 30)[0]
    $posterOk = (Invoke-E2e 'probe-hero-visual?visual=poster' 'SandboxE2E.*AREA=hero-visual RESULT=PASS' 45)[0]
    $collapseOk = (Invoke-E2e 'collapse-now-playing' 'SandboxE2E.*AREA=collapse-now-playing RESULT=PASS' 25)[0]
    $expandCollapseOk = $expandOk -and $posterOk -and $collapseOk
    $cases.Add([pscustomobject]@{ Case = 'expand-collapse-poster'; Result = $(if ($expandCollapseOk) { 'PASS' } else { 'FAIL' }); Notes = '' })

  Write-Host '  [4/5] Home/Search tab switch while playing ...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $tabOk = (Invoke-E2e 'tab-switch-stability' 'SandboxE2E.*AREA=tab-switch-stability RESULT=PASS' 60)[0]
    $cases.Add([pscustomobject]@{ Case = 'tab-switch'; Result = $(if ($tabOk) { 'PASS' } else { 'FAIL' }); Notes = '' })

  Write-Host '  [5/5] Long-press opens settings without mode thrash ...'
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    $settingsOk = (Invoke-E2e 'open-vinyl-settings' 'SandboxE2E.*AREA=vinyl-settings-open RESULT=PASS' 25)[0]
    $cases.Add([pscustomobject]@{ Case = 'long-press-settings'; Result = $(if ($settingsOk) { 'PASS' } else { 'FAIL' }); Notes = '' })

    $failCount = @($cases | Where-Object { $_.Result -ne 'PASS' }).Count
    return $cases, ($failCount -eq 0)
}

function Grant-EmulatorPermissions {
    Write-Host 'Granting emulator permissions ...'
    $perms = @(
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE'
    )
    foreach ($perm in $perms) {
        & adb.exe -s $EmuSerial shell pm grant $Package $perm 2>$null | Out-Null
    }
    & adb.exe -s $EmuSerial shell dumpsys deviceidle whitelist "+$Package" 2>$null | Out-Null
}

function Build-ApkIfStale {
    $apkPath = Join-Path $Root $ApkRel
    $srcNewer = Get-ChildItem -Path (Join-Path $Root 'src') -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not (Test-Path $apkPath)) {
        Write-Host 'APK missing - building ...'
        npm run build:android:apk
        return
    }
    if ($srcNewer -and $srcNewer.LastWriteTime -gt (Get-Item $apkPath).LastWriteTime) {
        Write-Host 'Source newer than APK - rebuilding ...'
        npm run build:android:apk
    } else {
        Write-Host "Using existing APK: $apkPath"
    }
}

$allResults = [System.Collections.Generic.List[object]]::new()
$wrongTrackIncidents = @()
$crashSnippets = @()
$vinylOk = $false
$switchCases = @()
$switchOk = $false
$firstFail = $null

Wait-EmulatorE2eLock
try {
  Set-Content -Path $EmulatorLockFile -Value "$PID $(Get-Date -Format o)" -Encoding ASCII

Assert-EmulatorOnly
Start-EmulatorIfNeeded
Assert-EmulatorOnly

Build-ApkIfStale
$apkPath = Join-Path $Root $ApkRel
if (-not (Test-Path $apkPath)) { throw "APK not found: $apkPath" }

Write-Host "Installing to $EmuSerial ONLY (never $ForbiddenSerial) ..."
Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
Grant-EmulatorPermissions

Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
Start-Sleep -Seconds 2
Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Invoke-Adb -Command @('logcat', '-c') | Out-Null
Write-Host 'Waiting for Capacitor WebView ready ...'
$null = Wait-AppReady

function Invoke-BootstrapE2e {
    param(
        [string]$Path,
        [string]$WaitPattern,
        [int]$TimeoutSec = 120,
        [int]$Retries = 3
    )
    for ($i = 0; $i -lt $Retries; $i += 1) {
        $ok, $line = Invoke-E2e $Path $WaitPattern $TimeoutSec
        if ($ok) { return $true }
        Write-Host "Bootstrap retry $($i + 1)/$Retries for $Path" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    return $false
}

$bootOk = Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45
if (-not $bootOk) { throw 'Bootstrap failed: skip-onboarding' }
$null = Invoke-BootstrapE2e 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 60
$null = Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90
$null = Invoke-BootstrapE2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45
$ytdlpOk = Invoke-BootstrapE2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180
if (-not $ytdlpOk) { throw 'Bootstrap failed: check-ytdlp' }
$null = Invoke-BootstrapE2e 'search?query=Kanye%20West' 'SandboxE2E.*AREA=search RESULT=PASS' 120
Start-Sleep -Seconds 3

Write-Host ''
Write-Host '=== Vinyl album switch stability ===' -ForegroundColor Cyan
$switchCases, $switchOk = Test-SwitchStability
foreach ($c in $switchCases) {
    $color = if ($c.Result -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host "  $($c.Case): $($c.Result) $($c.Notes)" -ForegroundColor $color
}
Write-Host $(if ($switchOk) { 'Switch stability: PASS' } else { 'Switch stability: FAIL' })

if ($SwitchStabilityOnly) {
    & adb.exe -s $EmuSerial logcat -d > $LogcatFile
    $switchReport = New-Object System.Text.StringBuilder
    [void]$switchReport.AppendLine('# Vinyl Album Switch Stability Report - Android Emulator')
    [void]$switchReport.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$switchReport.AppendLine(('Device: {0} (emulator only; phone {1} NOT used)' -f $EmuSerial, $ForbiddenSerial))
    [void]$switchReport.AppendLine('')
    [void]$switchReport.AppendLine('| Case | Result | Notes |')
    [void]$switchReport.AppendLine('|------|--------|-------|')
    foreach ($c in $switchCases) {
        $row = '| {0} | {1} | {2} |' -f $c.Case, $c.Result, $c.Notes
        [void]$switchReport.AppendLine($row)
    }
    [void]$switchReport.AppendLine('')
    [void]$switchReport.AppendLine("## Overall: $(if ($switchOk) { 'PASS' } else { 'FAIL' })")
    $switchText = $switchReport.ToString()
    Set-Content -Path $SwitchReportFile -Value $switchText -Encoding UTF8
    Write-Host ''
    Write-Host $switchText
    Write-Host "Report saved: $SwitchReportFile"
    if (-not $switchOk) { exit 1 }
    exit 0
}

Write-Host ''
Write-Host '=== Vinyl toggle (bidirectional) ===' -ForegroundColor Cyan
$vinylOk = Test-VinylToggle
Write-Host $(if ($vinylOk) { 'Vinyl toggle: PASS' } else { 'Vinyl toggle: FAIL' })

foreach ($albumSpec in $Albums) {
    $albumName = $albumSpec.Name
    Write-Host ''
    Write-Host "=== Album: $albumName ===" -ForegroundColor Cyan

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $encArtist = [uri]::EscapeDataString($Artist)
    $encAlbum = [uri]::EscapeDataString($albumName)
    $openPath = "open-album?artist=$encArtist" + '&album=' + $encAlbum
    $openOk = (Invoke-E2e $openPath 'SandboxE2E.*AREA=open-album RESULT=PASS' 480)[0]
    if (-not $openOk) {
        Write-Host "FAIL open-album for $albumName" -ForegroundColor Red
        foreach ($mode in $Modes) {
            $allResults.Add([pscustomobject]@{
                Track = '(open failed)'; Album = $albumName; Kind = 'album'; Mode = $mode
                NowPlaying = ''; ArtOk = '-'; Play = 'FAIL'; Progress = 'FAIL'; Notes = 'open-album FAIL'
            })
        }
        continue
    }

    Start-Sleep -Seconds 3
    $tracks = @()
    for ($try = 0; $try -lt 3; $try += 1) {
        $listOk, $listLine = Invoke-E2e 'list-album-tracks' 'SandboxE2E.*AREA=album-tracks RESULT=PASS' 90
        $tracks = @(Parse-AlbumTracksFromLine $listLine)
        if ($tracks.Count -eq 0) { $tracks = @(Parse-AlbumTracksFromLogcat) }
        if ($tracks.Count -gt 0) { break }
        Start-Sleep -Seconds 5
    }
    if ($tracks.Count -eq 0) {
        Write-Host "No tracks discovered for $albumName" -ForegroundColor Red
        continue
    }

    Write-Host "Discovered $($tracks.Count) tracks (expected ~$($albumSpec.ExpectedTracks))"
    $idx = 0
    foreach ($track in $tracks) {
        $idx += 1
        foreach ($mode in $Modes) {
            Write-Host "  [$idx/$($tracks.Count)] $track [$mode] ..."
            $row = Test-TrackPlayback -Kind 'album' -Artist $Artist -Album $albumName -Track $track -Mode $mode -ProgressSecs $ProgressSecs
            $allResults.Add([pscustomobject]$row)
            if ($row.NowPlaying -and -not (Titles-Match $row.NowPlaying $track)) {
                $wrongTrackIncidents += "$albumName / $track / $mode / playing=$($row.NowPlaying)"
            }
            if (($row.Play -ne 'PASS' -or $row.Progress -ne 'PASS') -and -not $firstFail) {
                $firstFail = "$albumName / $track / $mode"
                Write-Host "STOP: first failure at $firstFail" -ForegroundColor Red
                break
            }
        }
        if ($firstFail) { break }
    }
    if ($firstFail) { break }
}

if (-not $firstFail) {
    Write-Host ''
    Write-Host '=== Singles (artist page) ===' -ForegroundColor Cyan
    foreach ($single in $Singles) {
        foreach ($mode in $Modes) {
            Write-Host "  $($single.Track) [$mode] ..."
            $row = Test-TrackPlayback -Kind 'single' -Artist $single.Artist -Album '' -Track $single.Track -Mode $mode -ProgressSecs $ProgressSecs
            $allResults.Add([pscustomobject]$row)
            if ($row.NowPlaying -and -not (Titles-Match $row.NowPlaying $single.Track)) {
                $wrongTrackIncidents += "single / $($single.Track) / $mode / playing=$($row.NowPlaying)"
            }
            if (($row.Play -ne 'PASS' -or $row.Progress -ne 'PASS') -and -not $firstFail) {
                $firstFail = "single / $($single.Track) / $mode"
                Write-Host "STOP: first failure at $firstFail" -ForegroundColor Red
                break
            }
        }
        if ($firstFail) { break }
    }
}

& adb.exe -s $EmuSerial logcat -d > $LogcatFile
$logText = Get-Content $LogcatFile -Raw
$crashMatch = [regex]::Match($logText, '(?s)FATAL EXCEPTION.*?AndroidRuntime.*?rd\.sheepskin\.sandboxmusic.*?(?=\n\d{2}-\d{2})')
if ($crashMatch.Success) {
    $crashSnippets += $crashMatch.Value.Substring(0, [Math]::Min(800, $crashMatch.Value.Length))
}

$report = New-Object System.Text.StringBuilder
[void]$report.AppendLine('# Dual-Mode Album Stability Report - Android Emulator')
[void]$report.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$report.AppendLine(('Device: {0} (emulator only; phone {1} NOT used)' -f $EmuSerial, $ForbiddenSerial))
[void]$report.AppendLine('')
[void]$report.AppendLine('| Track | Album | Kind | Mode | Play | Progress | Art | Now-playing | Notes |')
[void]$report.AppendLine('|-------|-------|------|------|------|----------|-----|-------------|-------|')
foreach ($r in $allResults) {
    $line = '| {0} | {1} | {2} | {3} | {4} | {5} | {6} | {7} | {8} |' -f $r.Track, $r.Album, $r.Kind, $r.Mode, $r.Play, $r.Progress, $r.ArtOk, $r.NowPlaying, $r.Notes
    [void]$report.AppendLine($line)
}
[void]$report.AppendLine('')

$passRows = @($allResults | Where-Object { $_.Play -eq 'PASS' -and $_.Progress -eq 'PASS' })
$failRows = @($allResults | Where-Object { $_.Play -ne 'PASS' -or $_.Progress -ne 'PASS' })
[void]$report.AppendLine("## Summary: $($passRows.Count)/$($allResults.Count) cases PASS (play + progress)")
[void]$report.AppendLine("- Crashes: $(if ($crashSnippets.Count -gt 0) { 'YES' } else { 'NO' })")
[void]$report.AppendLine("- Wrong-track incidents: $($wrongTrackIncidents.Count)")
foreach ($w in $wrongTrackIncidents) { [void]$report.AppendLine("  - $w") }
[void]$report.AppendLine("- Vinyl toggle bidirectional: $(if ($vinylOk) { 'OK' } else { 'FAIL' })")
[void]$report.AppendLine("- Switch stability: $(if ($switchOk) { 'PASS' } else { 'FAIL' })")
foreach ($c in $switchCases) {
    [void]$report.AppendLine("  - $($c.Case): $($c.Result)")
}
if ($firstFail) { [void]$report.AppendLine("- First failure: $firstFail") }
[void]$report.AppendLine('')

$ready = ($allResults.Count -gt 0) -and ($failRows.Count -eq 0) -and ($wrongTrackIncidents.Count -eq 0) -and ($crashSnippets.Count -eq 0) -and $vinylOk -and $switchOk -and (-not $firstFail)
[void]$report.AppendLine('## Recommendation')
[void]$report.AppendLine("- Ready for phone install: $(if ($ready) { 'YES' } else { 'NO' })")
if (-not $ready) {
    [void]$report.AppendLine("- Reason: $($failRows.Count) failures, $($wrongTrackIncidents.Count) wrong-track, crashes=$($crashSnippets.Count -gt 0), vinyl=$vinylOk")
}

$reportText = $report.ToString()
Set-Content -Path $ReportFile -Value $reportText -Encoding UTF8
Write-Host ''
Write-Host $reportText
Write-Host ''
Write-Host "Full logcat: $LogcatFile"
Write-Host "Report saved: $ReportFile"

if (-not $ready) { exit 1 }
exit 0
} finally {
    Remove-Item $EmulatorLockFile -Force -ErrorAction SilentlyContinue
}
