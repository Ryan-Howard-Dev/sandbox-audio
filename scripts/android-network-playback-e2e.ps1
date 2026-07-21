# Sandbox Music — network + playback stability E2E (Android emulator ONLY)
# Usage: .\scripts\android-network-playback-e2e.ps1
#        .\scripts\android-network-playback-e2e.ps1 -SkipDownload
# NEVER installs to physical devices — emulator-5554 only.
#
# Network simulation notes (emulator):
# - WiFi/default: full speed (no throttle)
# - Throttled: `adb emu network speed edge` (EDGE ~50kbps) — emulator cannot distinguish 3G/4G/5G;
#   use edge/gsm/umts profiles or Charles/mitm for real-device cellular tests.
# - Drop: `svc wifi disable` + `svc data disable` mid-play

param(
    [switch]$SkipDownload,
    [switch]$SkipBuild,
    [switch]$QuickMode
)

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'

$AvdName = 'SandboxMusic_API36_x86_64'
$EmuSerial = 'emulator-5554'
$ForbiddenSerial = '46349770'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$Artist = 'Kanye West'
$Album = 'Bully'
$StreamTrack = 'KING'
$StreamTrack2 = 'FATHER'
$LockerTracks = @('KING', 'FATHER')
$ProgressSecs = 60
$IntegritySecs = 90
$Amp = [char]38
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'
$LogcatFile = Join-Path $Root '.network-playback-logcat.txt'
$ReportFile = Join-Path $Root '.network-playback-report.txt'

function Invoke-Adb {
    param([string[]]$Command)
    if (-not $Command -or $Command.Count -eq 0) { throw 'Invoke-Adb requires arguments' }
    Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command
    & adb.exe -s $EmuSerial @Command
    if ($LASTEXITCODE -ne 0) {
        throw ("adb failed: adb.exe " + ($Command -join ' '))
    }
}

function Invoke-AdbSoft {
    param([string[]]$Command)
    Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command
    & adb.exe -s $EmuSerial @Command 2>$null | Out-Null
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

function Wait-EmulatorE2eLock {
    param([int]$MaxWaitSec = 3600)
    if (-not (Test-Path $EmulatorLockFile)) { return }
    $deadline = (Get-Date).AddSeconds($MaxWaitSec)
    while ((Test-Path $EmulatorLockFile) -and (Get-Date) -lt $deadline) {
        $lockInfo = Get-Content $EmulatorLockFile -ErrorAction SilentlyContinue
        Write-Host "Emulator E2E lock present ($lockInfo) - waiting 30s ..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
    if (Test-Path $EmulatorLockFile) {
        throw "Emulator E2E lock still held after ${MaxWaitSec}s"
    }
}

function Invoke-DeepLink {
    param([string]$LinkPath)
    Start-E2eDeepLink -Path $LinkPath
    Start-Sleep -Seconds 2
}

function Invoke-BootstrapE2e {
    param(
        [string]$LinkPath,
        [string]$WaitPattern,
        [int]$TimeoutSec = 120,
        [int]$Retries = 3
    )
    for ($i = 0; $i -lt $Retries; $i += 1) {
        $ok, $line = Invoke-E2e $LinkPath $WaitPattern $TimeoutSec
        if ($ok) { return $true }
        Write-Host "Bootstrap retry $($i + 1)/$Retries for $LinkPath" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    return $false
}

function Write-NetworkReport {
    $failCount = @($Matrix | Where-Object {
            $_.Play -ne 'PASS' -and $_.Play -ne 'SKIP' -or
            ($_.Stable -ne 'PASS' -and $_.Stable -ne 'SKIP')
        }).Count
    $ready = ($failCount -eq 0)
    $report = New-Object System.Text.StringBuilder
    [void]$report.AppendLine('# Network + Playback Stability Report - Android Emulator')
    [void]$report.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$report.AppendLine(("Device: {0} (emulator only; phone {1} NOT used)" -f $EmuSerial, $ForbiddenSerial))
    [void]$report.AppendLine('')
    [void]$report.AppendLine('## Test matrix')
    [void]$report.AppendLine('| Source | Network | Play | Stable 60s | Notes |')
    [void]$report.AppendLine('|--------|---------|------|------------|-------|')
    foreach ($r in $Matrix) {
        [void]$report.AppendLine("| $($r.Source) | $($r.Network) | $($r.Play) | $($r.Stable) | $($r.Notes) |")
    }
    [void]$report.AppendLine('')
    [void]$report.AppendLine("## Overall: $(if ($ready) { 'PASS' } else { 'FAIL' }) ($failCount failures)")
    [void]$report.AppendLine('')
    [void]$report.AppendLine('## Emulator network simulation limits')
    [void]$report.AppendLine('- WiFi: default emulator virtual NIC at full speed.')
    [void]$report.AppendLine('- Mobile/throttle: adb emu network speed edge|gsm|umts (bandwidth/latency only; no separate 3G/4G/5G stacks).')
    [void]$report.AppendLine('- Real cellular: physical device 46349770; toggle airplane mode or field-test; Charles/mitm optional.')
    [void]$report.AppendLine('')
    [void]$report.AppendLine('## Code review (network-aware playback)')
    [void]$report.AppendLine('- hybridResolution: locker -> cache -> server -> mobile -> preview; Android mobile-first when resolvers active.')
    [void]$report.AppendLine('- playbackPipeline: skips server cache when tier34 unreachable; local-vault/stream-cache bypass network.')
    [void]$report.AppendLine('- offlineStatus: navigator.onLine + online/offline events + air-gap; no Capacitor Network plugin for WiFi/cell handoff.')
    [void]$report.AppendLine('- airGapMode: fetch guard blocks WAN; locker + LAN tier34 allowed.')
    [void]$report.AppendLine('')
    [void]$report.AppendLine("## Phone install: $(if ($ready) { 'YES' } else { 'NO' })")
    $text = $report.ToString()
    Set-Content -Path $ReportFile -Value $text -Encoding UTF8
    Write-Host ''
    Write-Host $text
    Write-Host "Report: $ReportFile"
    return $ready
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
        [string]$LinkPath,
        [string]$WaitPattern,
        [int]$TimeoutSec = 120
    )
    Invoke-DeepLink -LinkPath $LinkPath
    Start-Sleep -Seconds 2
    if (-not $WaitPattern) { return $false, '' }
    return Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
}

function Get-LogcatLines {
    param([string]$Pattern)
    $chunk = Get-LogcatChunk -Tail 20000
    if (-not $chunk) { return @() }
    $matches = [regex]::Matches($chunk, $Pattern)
    if ($matches.Count -eq 0) { return @() }
    return @($matches | ForEach-Object { $_.Value })
}

function Get-RegexGroup {
    param([string]$Text, [string]$Pattern, [int]$Group = 1)
    if (-not $Text) { return '' }
    $m = [regex]::Match($Text, $Pattern)
    if ($m.Success) { return $m.Groups[$Group].Value }
    return ''
}

function Grant-EmulatorPermissions {
    $perms = @(
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_MEDIA_AUDIO',
        'android.permission.READ_EXTERNAL_STORAGE'
    )
    foreach ($perm in $perms) {
        & adb.exe -s $EmuSerial shell pm grant $Package $perm 2>$null | Out-Null
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
        npm run build:android:apk
    }
}

function Set-EmulatorNetworkSpeed {
    param([string]$SpeedProfile)
    Write-Host "  Network speed: $SpeedProfile"
    & adb.exe -s $EmuSerial emu network speed $SpeedProfile 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: adb emu network speed failed - continuing with default" -ForegroundColor Yellow
    }
}

function Set-EmulatorNetworkFull {
    Set-EmulatorNetworkSpeed 'full'
}

function Disable-EmulatorNetwork {
    Write-Host '  Disabling WiFi + cellular data ...'
    Invoke-AdbSoft -Command @('shell', 'svc', 'wifi', 'disable')
    Invoke-AdbSoft -Command @('shell', 'svc', 'data', 'disable')
}

function Enable-EmulatorNetwork {
    Write-Host '  Re-enabling WiFi + cellular data ...'
    Invoke-AdbSoft -Command @('shell', 'svc', 'wifi', 'enable')
    Invoke-AdbSoft -Command @('shell', 'svc', 'data', 'enable')
    Set-EmulatorNetworkFull
}

function Add-MatrixRow {
    param(
        [string]$Source,
        [string]$Network,
        [string]$Play,
        [string]$Stable,
        [string]$Notes = ''
    )
    $script:Matrix.Add([pscustomobject]@{
        Source  = $Source
        Network = $Network
        Play    = $Play
        Stable  = $Stable
        Notes   = $Notes
    })
}

function Test-StreamTrack {
    param(
        [string]$Track,
        [string]$NetworkLabel,
        [string]$SpeedProfile = 'full'
    )
    Set-EmulatorNetworkSpeed $SpeedProfile
    Enable-EmulatorNetwork
    Start-Sleep -Seconds 2

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    $monitorQuery = "progressSeconds=$ProgressSecs${Amp}integritySeconds=$IntegritySecs"
    $playPath = "play-album-track?artist=$encArtist${Amp}album=$([uri]::EscapeDataString($Album))${Amp}track=$encTrack${Amp}$monitorQuery"
    $playTimeout = 420 + $ProgressSecs + $IntegritySecs + 120

    $waitPattern = 'SandboxE2E.*AREA=stream-integrity RESULT=(PASS|FAIL)'
    $null = Invoke-E2e $playPath $waitPattern $playTimeout

    $playLines = @(Get-LogcatLines 'SandboxE2E.*AREA=album-track-play RESULT=(PASS|FAIL)')
    $playLine = if ($playLines.Count -gt 0) { $playLines[-1] } else { '' }
    $progLines = @(Get-LogcatLines 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')
    $progLine = if ($progLines.Count -gt 0) { $progLines[-1] } else { '' }
    $integrityLines = @(Get-LogcatLines 'SandboxE2E.*AREA=stream-integrity RESULT=(PASS|FAIL)')
    $integrityLine = if ($integrityLines.Count -gt 0) { $integrityLines[-1] } else { '' }

    $playOk = $playLine -match 'RESULT=PASS'
    $progOk = $progLine -match 'RESULT=PASS'
    $integrityOk = $integrityLine -match 'RESULT=PASS'
    $notes = ''
    if (-not $progOk) {
        $notes += ' progress-fail'
        $reg = Get-RegexGroup $progLine 'regression=([\d.]+)s'
        if ($reg) { $notes += " regression=${reg}s" }
    }
    if (-not $integrityOk) {
        $reason = Get-RegexGroup $integrityLine 'reason=([^ ]+)'
        $notes += " integrity=$reason"
    }

    $stable = if ($progOk -and $integrityOk) { 'PASS' } else { 'FAIL' }
    Add-MatrixRow 'Stream' $NetworkLabel $(if ($playOk) { 'PASS' } else { 'FAIL' }) $stable $notes.Trim()

    $null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20
    Start-Sleep -Seconds 2
    return ($playOk -and $progOk -and $integrityOk)
}

function Test-NetworkDropDuringStream {
    param([string]$Track)
    Enable-EmulatorNetwork
    Set-EmulatorNetworkFull
    Invoke-Adb -Command @('logcat', '-c') | Out-Null

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    $playPath = "play-album-track?artist=$encArtist${Amp}album=$([uri]::EscapeDataString($Album))${Amp}track=$encTrack${Amp}progressSeconds=0${Amp}integritySeconds=0"
    Invoke-DeepLink $playPath
    Start-Sleep -Seconds 2

    $playOk = $false
    $deadline = (Get-Date).AddSeconds(420)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk
        if ($chunk -match 'SandboxE2E.*AREA=album-track-play RESULT=PASS') {
            $playOk = $true
            break
        }
        if ($chunk -match 'SandboxE2E.*AREA=album-track-play RESULT=FAIL') { break }
        Start-Sleep -Seconds 2
    }
    if (-not $playOk) {
        Add-MatrixRow 'Stream' 'drop-mid-play' 'FAIL' 'SKIP' 'play-never-started'
        return $false
    }

    Start-Sleep -Seconds 18
    Disable-EmulatorNetwork
    Start-Sleep -Seconds 25

    $chunk = Get-LogcatChunk -Tail 8000
    $graceful = ($chunk -match 'native-(idle|error)-mid-play') -or
        ($chunk -match 'SandboxE2E.*AREA=stream-integrity RESULT=FAIL') -or
        ($chunk -match 'state=error') -or
        ($chunk -match 'state=idle')
    $infiniteSpinner = -not $graceful -and ($chunk -match 'state=loading')

    Enable-EmulatorNetwork
    $null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20

    $note = if ($graceful) { 'graceful-error-or-idle' } elseif ($infiniteSpinner) { 'infinite-spinner' } else { 'unknown-state' }
    Add-MatrixRow 'Stream' 'network-drop' 'PASS' $(if ($graceful) { 'PASS' } else { 'FAIL' }) $note
    return $graceful
}

$Matrix = [System.Collections.Generic.List[object]]::new()
$script:TestFailed = $false

if ($QuickMode) {
    $ProgressSecs = 30
    $IntegritySecs = 45
}

Initialize-ExclusiveEmulatorE2e -ForceStopApp
Wait-EmulatorE2eLock
Assert-EmulatorOnly
Start-EmulatorIfNeeded
Assert-EmulatorOnly

$lockCreated = $false
try {
    Set-Content -Path $EmulatorLockFile -Value "$PID network-playback-e2e $(Get-Date -Format o)" -Encoding UTF8
    $lockCreated = $true

    Build-ApkIfStale
    $apkPath = Join-Path $Root $ApkRel
    if (-not (Test-Path $apkPath)) { throw "APK not found: $apkPath" }

    Write-Host "Installing to $EmuSerial ONLY ..."
    Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
    Grant-EmulatorPermissions

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 2
    Write-Host 'Cold-starting app ...'
    $bootUri = 'sandboxmusic://e2e/skip-onboarding'
    $bootCmd = "am start -a android.intent.action.VIEW -d '$bootUri' -f 0x14000000 $Package"
    & adb.exe -s $EmuSerial shell $bootCmd | Out-Null
    Write-Host 'Waiting for WebView + E2E bridge (25s) ...'
    Start-Sleep -Seconds 25

    if (-not (Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45)) {
        throw 'Bootstrap failed: skip-onboarding'
    }
    if (-not (Invoke-BootstrapE2e 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 30)) {
        throw 'Bootstrap failed: probe-bridge'
    }
    if (-not (Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 60)) {
        throw 'Bootstrap failed: probe-handlers'
    }
    $null = Invoke-BootstrapE2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45
    $ytdlpOk = Invoke-BootstrapE2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180
    if (-not $ytdlpOk) { throw 'Bootstrap failed: check-ytdlp' }

    $encArtist = [uri]::EscapeDataString($Artist)
    $encAlbum = [uri]::EscapeDataString($Album)
    $encStream = [uri]::EscapeDataString($StreamTrack)
    $encStream2 = [uri]::EscapeDataString($StreamTrack2)

    if (-not $SkipDownload) {
        Write-Host ''
        Write-Host '=== Download locker tracks for offline tests ===' -ForegroundColor Cyan
        foreach ($t in $LockerTracks) {
            $encT = [uri]::EscapeDataString($t)
            Invoke-Adb -Command @('logcat', '-c') | Out-Null
            $dlPath = "download-track?artist=$encArtist${Amp}album=$encAlbum${Amp}title=$encT${Amp}mode=tracks"
            $dlOk = (Invoke-E2e $dlPath 'SandboxE2E.*AREA=download-track RESULT=PASS' 900)[0]
            if (-not $dlOk) {
                Write-Host "  Download $t FAILED" -ForegroundColor Red
            } else {
                $verifyOk = (Invoke-E2e "verify-locker-cache?artist=$encArtist${Amp}title=$encT${Amp}album=$encAlbum" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 30)[0]
                Write-Host "  Download $t $(if ($verifyOk) { 'PASS' } else { 'FAIL verify' })"
            }
        }
    } else {
        Write-Host 'Skipping downloads (-SkipDownload)' -ForegroundColor Yellow
    }

    Write-Host ''
    Write-Host '=== A. Stream / WiFi (default) ===' -ForegroundColor Cyan
    $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
    try { Test-StreamTrack -Track $StreamTrack -NetworkLabel 'WiFi' -SpeedProfile 'full' | Out-Null } catch { $script:TestFailed = $true; Add-MatrixRow 'Stream' 'WiFi' 'FAIL' 'FAIL' $_.Exception.Message }

    if (-not $QuickMode) {
        Write-Host ''
        Write-Host '=== A2. Stream / throttled (EDGE) ===' -ForegroundColor Cyan
        $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
        try { Test-StreamTrack -Track $StreamTrack2 -NetworkLabel 'throttled-edge' -SpeedProfile 'edge' | Out-Null } catch { $script:TestFailed = $true; Add-MatrixRow 'Stream' 'throttled-edge' 'FAIL' 'FAIL' $_.Exception.Message }
        Set-EmulatorNetworkFull

        Write-Host ''
        Write-Host '=== A3. Network drop mid-stream ===' -ForegroundColor Cyan
        $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
        try { Test-NetworkDropDuringStream -Track $StreamTrack | Out-Null } catch { $script:TestFailed = $true; Add-MatrixRow 'Stream' 'network-drop' 'FAIL' 'SKIP' $_.Exception.Message }
    } else {
        Add-MatrixRow 'Stream' 'throttled-edge' 'SKIP' 'SKIP' 'QuickMode'
        Add-MatrixRow 'Stream' 'network-drop' 'SKIP' 'SKIP' 'QuickMode'
    }

    Write-Host ''
    Write-Host '=== B. Locker / offline ===' -ForegroundColor Cyan
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Disable-EmulatorNetwork
    $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
    $offlinePath = "play-offline?artist=$encArtist${Amp}track=$encStream${Amp}album=$encAlbum"
    $offlineOk = (Invoke-E2e $offlinePath 'SandboxE2E.*AREA=play-offline RESULT=PASS' 180)[0]
    $fileOk = $false
    if ($offlineOk) {
        $null = Invoke-E2e 'probe-exo' '' 10
        $probeLine = (Get-LogcatLines 'SandboxE2E.*AREA=exo-probe RESULT=PASS')[-1]
        $fileOk = $probeLine -match 'file=true'
        $null = Invoke-E2e "wait-progress?seconds=30" 'SandboxE2E.*AREA=playback-progress RESULT=PASS' 120
        $progLine = (Get-LogcatLines 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')[-1]
        $stableOk = $progLine -match 'RESULT=PASS'
    } else {
        $stableOk = $false
    }
    Enable-EmulatorNetwork
    Add-MatrixRow 'Locker' 'offline' $(if ($offlineOk) { 'PASS' } else { 'FAIL' }) $(if ($stableOk) { 'PASS' } else { 'FAIL' }) $(if ($fileOk) { 'local-file' } else { 'no-file-url' })
    $null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20

    Write-Host ''
    Write-Host '=== C. Playlist / streamed ===' -ForegroundColor Cyan
    $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $seqOk = $true
    $null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20
    $null = Invoke-E2e "open-album?artist=$encArtist${Amp}album=$encAlbum" 'SandboxE2E.*AREA=open-album RESULT=PASS' 180
    $null = Invoke-E2e 'list-album-tracks' 'SandboxE2E.*AREA=album-tracks RESULT=PASS' 60
    $trackListMatch = [regex]::Match((Get-LogcatChunk -Tail 20000), 'AREA=album-tracks RESULT=PASS count=\d+ tracks=([^\r\n]+)')
    if (-not $trackListMatch.Success) {
        $seqOk = $false
    } else {
        $seqTitles = @(($trackListMatch.Groups[1].Value -split '\|') | Select-Object -First 3)
        foreach ($seqTitle in $seqTitles) {
            $encSeqTrack = [uri]::EscapeDataString($seqTitle)
            $null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20
            Invoke-Adb -Command @('logcat', '-c') | Out-Null
            $seqPlayPath = "play-album-track?artist=$encArtist${Amp}album=$encAlbum${Amp}track=$encSeqTrack${Amp}progressSeconds=3"
            $trackOk = (Invoke-E2e $seqPlayPath 'SandboxE2E.*AREA=album-track-play RESULT=PASS' 360)[0]
            if (-not $trackOk) {
                $seqOk = $false
                break
            }
        }
    }
    Add-MatrixRow 'Playlist' 'streamed' $(if ($seqOk) { 'PASS' } else { 'FAIL' }) $(if ($seqOk) { 'PASS' } else { 'FAIL' }) 'album-sequence x3'

    Write-Host ''
    Write-Host '=== C2. Playlist / locker offline ===' -ForegroundColor Cyan
    Disable-EmulatorNetwork
    $null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $tracksParam = ($LockerTracks -join '|')
    $encTracks = [uri]::EscapeDataString($tracksParam)
    $lockerSeqPath = "play-locker-sequence?artist=$encArtist${Amp}album=$encAlbum${Amp}tracks=$encTracks"
    $lockerSeqOk = (Invoke-E2e $lockerSeqPath 'SandboxE2E.*AREA=locker-sequence RESULT=PASS' 600)[0]
    Enable-EmulatorNetwork
    Add-MatrixRow 'Playlist' 'locker-offline' $(if ($lockerSeqOk) { 'PASS' } else { 'FAIL' }) $(if ($lockerSeqOk) { 'PASS' } else { 'FAIL' }) 'locker-sequence'

    & adb.exe -s $EmuSerial logcat -d > $LogcatFile

    $ready = Write-NetworkReport
    if (-not $ready) { exit 1 }
    exit 0
} catch {
    $script:TestFailed = $true
    Write-Host "E2E error: $($_.Exception.Message)" -ForegroundColor Red
    if ($Matrix.Count -eq 0) {
        Add-MatrixRow 'bootstrap' 'n/a' 'FAIL' 'FAIL' $_.Exception.Message
    }
    & adb.exe -s $EmuSerial logcat -d > $LogcatFile -ErrorAction SilentlyContinue
    Write-NetworkReport | Out-Null
    exit 1
} finally {
    Enable-EmulatorNetwork
    if ($lockCreated -and (Test-Path $EmulatorLockFile)) {
        Remove-Item $EmulatorLockFile -Force -ErrorAction SilentlyContinue
    }
}
