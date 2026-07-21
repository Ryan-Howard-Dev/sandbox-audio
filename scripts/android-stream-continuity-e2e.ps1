# Sandbox Music — stream continuity E2E (Android emulator ONLY)
# Usage: .\scripts\android-stream-continuity-e2e.ps1
# Tests: monotonic position, no title/envelope bleed, no crash, Exo state stability.

param(
    [switch]$SkipBuild
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
$ProgressSecs = 60
$IntegritySecs = 90
$LogcatFile = Join-Path $Root '.stream-continuity-logcat.txt'
$ReportFile = Join-Path $Root '.stream-continuity-report.txt'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'

$Tracks = @(
    @{ Kind = 'album'; Album = 'Bully'; Track = 'KING' }
    @{ Kind = 'single'; Album = ''; Track = 'FATHER' }
    @{ Kind = 'album'; Album = 'Jesus Is King'; Track = 'Follow God' }
    @{ Kind = 'single'; Album = ''; Track = 'Closed On Sunday' }
    @{ Kind = 'single'; Album = ''; Track = 'Selah' }
)

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
    if ($LASTEXITCODE -ne 0) { throw ("adb deep link failed: $uri") }
}

function Get-LogcatChunk {
    param([int]$Tail = 16000)
    $raw = & adb.exe -s $EmuSerial logcat -d -t $Tail 2>$null
    if ($null -eq $raw) { return '' }
    if ($raw -is [array]) { return ($raw -join "`n") }
    return [string]$raw
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
    Start-Sleep -Seconds 2
    if (-not $WaitPattern) { return $true, '' }
    $ok, $line = Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
    if (-not $ok -and -not $AllowFail) {
        Write-Host "E2E timeout: $Path (pattern=$WaitPattern)" -ForegroundColor Yellow
    }
    return $ok, $line
}

function Get-LogcatLines {
    param([string]$Pattern)
    $chunk = Get-LogcatChunk -Tail 20000
    if (-not $chunk) { return @() }
    $matches = [regex]::Matches($chunk, $Pattern)
    if ($matches.Count -eq 0) { return @() }
    return @($matches | ForEach-Object { $_.Value })
}

function Invoke-CancelPlay {
    Invoke-E2e 'cancel-play' 'SandboxE2E.*AREA=cancel-play RESULT=PASS' 30 | Out-Null
    Start-Sleep -Seconds 2
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

function Wait-AppReady {
    param([int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk -Tail 3000
        if ($chunk -match 'Loading app at https://localhost' -or $chunk -match 'App started') {
            Start-Sleep -Seconds 20
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Write-Host 'App ready wait timed out — continuing with fixed delay' -ForegroundColor Yellow
    Start-Sleep -Seconds 25
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
        Write-Host "Removing stale emulator lock ($EmulatorLockFile)" -ForegroundColor Yellow
        Remove-Item -Force $EmulatorLockFile -ErrorAction SilentlyContinue
    }
}

function Build-ApkIfStale {
    if ($SkipBuild) {
        Write-Host 'Skipping APK build (-SkipBuild)'
        return
    }
    $apkPath = Join-Path $Root $ApkRel
    $srcNewer = Get-ChildItem -Path (Join-Path $Root 'src'), (Join-Path $Root 'android') -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not (Test-Path $apkPath)) {
        Write-Host 'APK missing - building ...'
        npm run build:android:apk
        return
    }
    if ($srcNewer -and $srcNewer.LastWriteTime -gt (Get-Item $apkPath).LastWriteTime) {
        Write-Host 'Source newer than APK - rebuilding ...'
        try {
            npm run build:android:apk
        } catch {
            Write-Host "APK build failed ($($_.Exception.Message)) - using existing APK if present" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Using existing APK: $apkPath"
    }
}

function Test-StreamTrack {
    param(
        [string]$Kind,
        [string]$Album,
        [string]$Track
    )
    $result = [ordered]@{
        Track       = $Track
        Album       = $Album
        Kind        = $Kind
        Play        = 'FAIL'
        Progress    = 'FAIL'
        Integrity   = 'FAIL'
        Crash       = 'NO'
        Notes       = ''
    }

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    $amp = [char]38
    $monitorQuery = "progressSeconds=$ProgressSecs${amp}integritySeconds=$IntegritySecs"
    if ($Kind -eq 'album') {
        $encAlbum = [uri]::EscapeDataString($Album)
        $playPath = "play-album-track?artist=$encArtist${amp}album=$encAlbum${amp}track=$encTrack${amp}$monitorQuery"
        $playFailArea = 'album-track-play'
        $playTimeout = 420 + $ProgressSecs + $IntegritySecs + 120
    } else {
        $playPath = "play-artist-track?artist=$encArtist${amp}track=$encTrack${amp}$monitorQuery"
        $playFailArea = 'artist-track-play'
        $playTimeout = 240 + $ProgressSecs + $IntegritySecs + 120
    }

    $waitPattern = 'SandboxE2E.*AREA=stream-integrity RESULT=(PASS|FAIL)'
    $null = Invoke-E2e $playPath $waitPattern $playTimeout -AllowFail
    Start-Sleep -Seconds 2

    $playLines = @(Get-LogcatLines "SandboxE2E.*AREA=$playFailArea RESULT=(PASS|FAIL)")
    $playLine = if ($playLines.Count -gt 0) { $playLines[-1] } else { '' }
    if ($playLine -match 'RESULT=PASS') { $result.Play = 'PASS' }

    $progLines = @(Get-LogcatLines 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')
    $progLine = if ($progLines.Count -gt 0) { $progLines[-1] } else { '' }
    if ($progLine -match 'RESULT=PASS') {
        $result.Progress = 'PASS'
    } elseif ($progLine) {
        $mono = Get-RegexGroup $progLine 'monotonic=(true|false)'
        $reg = Get-RegexGroup $progLine 'regression=([\d.]+)s'
        if ($mono -eq 'false' -or $reg) {
            $result.Notes += " position-jump regression=${reg}s"
        } else {
            $result.Notes += ' progress-stuck'
        }
    } elseif ($result.Play -ne 'PASS') {
        $result.Notes = "$playFailArea FAIL"
    } else {
        $result.Notes += ' progress-timeout'
    }

    $integrityLines = @(Get-LogcatLines 'SandboxE2E.*AREA=stream-integrity RESULT=(PASS|FAIL)')
    $integrityLine = if ($integrityLines.Count -gt 0) { $integrityLines[-1] } else { '' }
    if ($integrityLine -match 'RESULT=PASS') {
        $result.Integrity = 'PASS'
    } elseif ($integrityLine) {
        $reason = Get-RegexGroup $integrityLine 'reason=([^ ]+)'
        $result.Notes += " integrity-fail reason=$reason"
    } elseif ($result.Play -eq 'PASS') {
        $result.Notes += ' integrity-timeout'
    }

    if ($result.Play -ne 'PASS') {
        Invoke-CancelPlay
    }

    $crashLines = @(Get-LogcatLines '(?s)FATAL EXCEPTION.*?AndroidRuntime')
    if ($crashLines.Count -gt 0) {
        $result.Crash = 'YES'
        $result.Notes += ' AndroidRuntime crash'
    }

    Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20 | Out-Null
    Start-Sleep -Seconds 2
    return $result
}

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

Invoke-Adb -Command @('logcat', '-c') | Out-Null
Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
Start-Sleep -Seconds 2
Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
Invoke-Adb -Command @('logcat', '-c') | Out-Null
Write-Host 'Waiting for Capacitor WebView + E2E bridge ...'
$null = Wait-AppReady

$bootOk = Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45
if (-not $bootOk) { throw 'Bootstrap failed: skip-onboarding' }
$bridgeOk = Invoke-BootstrapE2e 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 60
if (-not $bridgeOk) { throw 'Bootstrap failed: E2E bridge not ready' }
$handlersOk = Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90
if (-not $handlersOk) { throw 'Bootstrap failed: E2E handlers not registered' }
$null = Invoke-BootstrapE2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45
$ytdlpOk = Invoke-BootstrapE2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180
if (-not $ytdlpOk) { throw 'Bootstrap failed: check-ytdlp' }
$searchOk = Invoke-BootstrapE2e 'search?query=Kanye%20West' 'SandboxE2E.*AREA=search RESULT=PASS' 180
if (-not $searchOk) { throw 'Bootstrap failed: search' }
Start-Sleep -Seconds 3

$allResults = [System.Collections.Generic.List[object]]::new()
Write-Host ''
Write-Host '=== Stream continuity (5 sample tracks) ===' -ForegroundColor Cyan

foreach ($spec in $Tracks) {
    $label = if ($spec.Album) { "$($spec.Album) / $($spec.Track)" } else { $spec.Track }
    Write-Host "  Testing $label ..."
    $row = Test-StreamTrack -Kind $spec.Kind -Album $spec.Album -Track $spec.Track
    $allResults.Add([pscustomobject]$row)
    $pass = ($row.Play -eq 'PASS' -and $row.Progress -eq 'PASS' -and $row.Integrity -eq 'PASS' -and $row.Crash -eq 'NO')
    Write-Host $(if ($pass) { "    PASS" } else { "    FAIL: $($row.Notes)" }) -ForegroundColor $(if ($pass) { 'Green' } else { 'Red' })
}

& adb.exe -s $EmuSerial logcat -d > $LogcatFile
$logText = Get-Content $LogcatFile -Raw
$crashMatch = [regex]::Match($logText, '(?s)FATAL EXCEPTION.*?AndroidRuntime.*?rd\.sheepskin\.sandboxmusic.*?(?=\n\d{2}-\d{2})')

$report = New-Object System.Text.StringBuilder
[void]$report.AppendLine('# Stream Continuity Report - Android Emulator')
[void]$report.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$report.AppendLine(('Device: {0} (emulator only; phone {1} NOT used)' -f $EmuSerial, $ForbiddenSerial))
[void]$report.AppendLine("Progress window: ${ProgressSecs}s | Integrity window: ${IntegritySecs}s")
[void]$report.AppendLine('')
[void]$report.AppendLine('| Track | Album | Kind | Play | Progress | Integrity | Crash | Notes |')
[void]$report.AppendLine('|-------|-------|------|------|----------|-----------|-------|-------|')
foreach ($r in $allResults) {
    [void]$report.AppendLine("| $($r.Track) | $($r.Album) | $($r.Kind) | $($r.Play) | $($r.Progress) | $($r.Integrity) | $($r.Crash) | $($r.Notes) |")
}
[void]$report.AppendLine('')

$passRows = @($allResults | Where-Object { $_.Play -eq 'PASS' -and $_.Progress -eq 'PASS' -and $_.Integrity -eq 'PASS' -and $_.Crash -eq 'NO' })
[void]$report.AppendLine("## Summary: $($passRows.Count)/$($allResults.Count) tracks PASS (play + progress + integrity)")
[void]$report.AppendLine("- Global crash in logcat: $(if ($crashMatch.Success) { 'YES' } else { 'NO' })")
[void]$report.AppendLine('')

$reportText = $report.ToString()
Set-Content -Path $ReportFile -Value $reportText -Encoding UTF8
Write-Host ''
Write-Host $reportText
Write-Host ''
Write-Host "Full logcat: $LogcatFile"
Write-Host "Report saved: $ReportFile"

if ($passRows.Count -lt $allResults.Count -or $crashMatch.Success) { exit 1 }
exit 0
} finally {
    if (Test-Path $EmulatorLockFile) {
        Remove-Item -Force $EmulatorLockFile -ErrorAction SilentlyContinue
    }
}
