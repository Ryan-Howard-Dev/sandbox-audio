# Mobile vinyl settings matrix E2E (Android emulator ONLY)
# Usage: .\scripts\android-vinyl-settings-e2e.ps1
#        .\scripts\android-vinyl-settings-e2e.ps1 -WaitForLock
# NEVER installs to physical devices — emulator-5554 only.

param(
    [switch]$WaitForLock
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
$Album = 'Jesus Is King'
$Tracks = @('KING', 'FATHER')
$HeroModes = @('album-cover', 'vinyl-shades')
$VisualPresets = @('subtle', 'glow')
$SliderCases = @(
    @{ Key = 'universeIntensity'; Value = 80 }
    @{ Key = 'colorThrow'; Value = 70 }
    @{ Key = 'pulse'; Value = 60 }
)
$ThemeCases = @('Focus', 'Tactical Midnight', 'Deep Ocean')
$ProgressSecs = 30
$LogcatFile = Join-Path $Root '.vinyl-settings-logcat.txt'
$ReportFile = Join-Path $Root '.vinyl-settings-report.txt'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'

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
    $devices = (& adb devices 2>$null) -join "`n"
    if ($devices -match "${EmuSerial}\s+offline") {
        Write-Host "Emulator $EmuSerial offline — restarting ..."
        & adb.exe -s $EmuSerial emu kill 2>$null | Out-Null
        Start-Sleep -Seconds 5
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

function Wait-AppReady {
    param([int]$TimeoutSec = 120)
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
    if (-not $WaitForLock) { return }
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

function Set-HeroMode {
    param([string]$Mode)
    $null = Invoke-E2e "set-vinyl-mode?mode=$Mode" "SandboxE2E.*AREA=vinyl-mode-set RESULT=PASS mode=$Mode" 20
    return (Invoke-E2e "probe-vinyl?mode=$Mode" "SandboxE2E.*AREA=vinyl-mode RESULT=PASS mode=$Mode" 15)[0]
}

function Apply-Setting {
    param([string]$SettingLabel, [string]$E2ePath, [string]$WaitPattern)
    $ok = (Invoke-E2e $E2ePath $WaitPattern 25)[0]
    if (-not $ok) { throw "Setting apply failed: $SettingLabel ($E2ePath)" }
}

function Test-SettingPlayback {
    param(
        [string]$Setting,
        [string]$HeroMode,
        [string]$Track,
        [string]$Kind
    )
    $result = [ordered]@{
        Setting    = $Setting
        HeroMode   = $HeroMode
        Track      = $Track
        Kind       = $Kind
        Play       = 'FAIL'
        Progress   = 'FAIL'
        Controls   = '-'
        Notes      = ''
    }

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    if (-not (Set-HeroMode $HeroMode)) {
        $result.Notes = 'hero-mode-set FAIL'
        return $result
    }

    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString($Track)
    if ($Kind -eq 'album') {
        $encAlbum = [uri]::EscapeDataString($Album)
        $playPath = "play-album-track?artist=$encArtist" + '&album=' + $encAlbum + '&track=' + $encTrack
        $playPattern = 'SandboxE2E.*AREA=album-track-play RESULT=PASS'
    } else {
        $playPath = "play-artist-track?artist=$encArtist" + '&track=' + $encTrack
        $playPattern = 'SandboxE2E.*AREA=artist-track-play RESULT=PASS'
    }

    $playOk = (Invoke-E2e $playPath $playPattern 180)[0]
    if (-not $playOk) {
        $result.Notes = 'play FAIL'
        return $result
    }
    $result.Play = 'PASS'

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $progOk = (Invoke-E2e "wait-progress?seconds=$ProgressSecs" 'SandboxE2E.*AREA=playback-progress RESULT=PASS' ($ProgressSecs + 90))[0]
    if ($progOk) {
        $result.Progress = 'PASS'
    } else {
        $progLine = (Get-LogcatLines 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')[-1]
        $result.Notes = if ($progLine) { $progLine } else { 'progress-timeout' }
    }

    Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20 | Out-Null
    Start-Sleep -Seconds 2
    return $result
}

$matrix = [System.Collections.Generic.List[object]]::new()
$controlRows = [System.Collections.Generic.List[object]]::new()
$probeOk = $false
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

    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Write-Host 'Waiting for Capacitor WebView ready ...'
    $null = Wait-AppReady

    $bootOk = Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45
    if (-not $bootOk) { throw 'Bootstrap failed: skip-onboarding' }
    $null = Invoke-BootstrapE2e 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 60
    $null = Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90
    $null = Invoke-BootstrapE2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45
    $ytdlpOk = Invoke-BootstrapE2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180
    if (-not $ytdlpOk) { throw 'Bootstrap failed: check-ytdlp' }
    $searchOk = Invoke-BootstrapE2e 'search?query=Kanye%20West' 'SandboxE2E.*AREA=search RESULT=PASS' 120
    if (-not $searchOk) { throw 'Bootstrap failed: search' }
    Start-Sleep -Seconds 3

    Write-Host ''
    Write-Host '=== Mobile vinyl settings DOM probe (no Trip/DMT) ===' -ForegroundColor Cyan
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    $probeOk = (Invoke-E2e 'probe-mobile-vinyl-settings' 'SandboxE2E.*AREA=mobile-vinyl-settings-probe RESULT=PASS' 30)[0]
    Write-Host $(if ($probeOk) { 'DOM probe: PASS' } else { 'DOM probe: FAIL' })
    if (-not $probeOk) { throw 'DOM probe failed: Trip/DMT visible or mobile sheet incomplete' }

    Write-Host ''
    Write-Host '=== Warm-up play (FATHER) for playback matrix ===' -ForegroundColor Cyan
    $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
    Start-Sleep -Seconds 1
    $encArtist = [uri]::EscapeDataString($Artist)
    $encTrack = [uri]::EscapeDataString('FATHER')
    $warmOk = (Invoke-E2e "play-artist-track?artist=$encArtist&track=$encTrack" 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 180)[0]
    if (-not $warmOk) { throw 'Warm-up play failed: FATHER' }
    Start-Sleep -Seconds 4

    Write-Host ''
    Write-Host '=== Preset matrix (subtle/glow x album/vinyl x KING/FATHER) ===' -ForegroundColor Cyan
    foreach ($preset in $VisualPresets) {
        Apply-Setting "preset=$preset" "set-vinyl-visual-preset?preset=$preset" "SandboxE2E.*AREA=vinyl-visual-preset RESULT=PASS preset=$preset"
        foreach ($heroMode in $HeroModes) {
            foreach ($track in $Tracks) {
                $kind = if ($track -eq 'KING') { 'album' } else { 'single' }
                $label = "preset=$preset"
                Write-Host "  [$label][$heroMode][$track] ..."
                $row = Test-SettingPlayback -Setting $label -HeroMode $heroMode -Track $track -Kind $kind
                $matrix.Add([pscustomobject]$row)
                if (($row.Play -ne 'PASS' -or $row.Progress -ne 'PASS') -and -not $firstFail) {
                    $firstFail = "$label / $heroMode / $track"
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
        Write-Host '=== Slider extremes ===' -ForegroundColor Cyan
        foreach ($slider in $SliderCases) {
            $label = "slider=$($slider.Key)=$($slider.Value)"
            Apply-Setting $label "set-vinyl-visual-slider?key=$($slider.Key)&value=$($slider.Value)" "SandboxE2E.*AREA=vinyl-visual-slider RESULT=PASS $($slider.Key)=$($slider.Value)"
            foreach ($heroMode in $HeroModes) {
                Write-Host "  [$label][$heroMode][KING] ..."
                $row = Test-SettingPlayback -Setting $label -HeroMode $heroMode -Track 'KING' -Kind 'album'
                $matrix.Add([pscustomobject]$row)
                if (($row.Play -ne 'PASS' -or $row.Progress -ne 'PASS') -and -not $firstFail) {
                    $firstFail = "$label / $heroMode / KING"
                    break
                }
            }
            if ($firstFail) { break }
        }
    }

    if (-not $firstFail) {
        Write-Host ''
        Write-Host '=== Theme presets ===' -ForegroundColor Cyan
        foreach ($tone in $ThemeCases) {
            $encTone = [uri]::EscapeDataString($tone)
            $label = "theme=$tone"
            Apply-Setting $label "set-theme-preset?tone=$encTone" 'SandboxE2E.*AREA=theme-preset RESULT=PASS'
            foreach ($heroMode in $HeroModes) {
                Write-Host "  [$label][$heroMode][FATHER] ..."
                $row = Test-SettingPlayback -Setting $label -HeroMode $heroMode -Track 'FATHER' -Kind 'single'
                $matrix.Add([pscustomobject]$row)
                if (($row.Play -ne 'PASS' -or $row.Progress -ne 'PASS') -and -not $firstFail) {
                    $firstFail = "$label / $heroMode / FATHER"
                    break
                }
            }
            if ($firstFail) { break }
        }
    }

    if (-not $firstFail) {
        Write-Host ''
        Write-Host '=== Hero controls (both display modes) ===' -ForegroundColor Cyan
        $null = Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30
        $encArtist = [uri]::EscapeDataString($Artist)
        $encTrack = [uri]::EscapeDataString('FATHER')
        $null = Invoke-E2e "play-artist-track?artist=$encArtist&track=$encTrack" 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' 180
        Start-Sleep -Seconds 3
        foreach ($heroMode in $HeroModes) {
            Invoke-Adb -Command @('logcat', '-c') | Out-Null
            $encMode = [uri]::EscapeDataString($heroMode)
            $ctrlOk = (Invoke-E2e "test-hero-controls?mode=$encMode" 'SandboxE2E.*AREA=hero-controls RESULT=PASS' 60)[0]
            $controlRows.Add([pscustomobject]@{
                HeroMode = $heroMode
                Controls = $(if ($ctrlOk) { 'PASS' } else { 'FAIL' })
            })
            if (-not $ctrlOk -and -not $firstFail) {
                $firstFail = "controls / $heroMode"
            }
        }
    }

    & adb.exe -s $EmuSerial logcat -d > $LogcatFile

    $report = New-Object System.Text.StringBuilder
    [void]$report.AppendLine('# Mobile Vinyl Settings Matrix - Android Emulator')
    [void]$report.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$report.AppendLine(('Device: {0} (emulator only; phone {1} NOT used)' -f $EmuSerial, $ForbiddenSerial))
    [void]$report.AppendLine('')
    [void]$report.AppendLine('## Mobile exposed vs Windows-only')
    [void]$report.AppendLine('- Mobile: hero album/vinyl, 3 theme presets, subtle+glow, 3 sliders (glow/color/pulse)')
    [void]$report.AppendLine('- Windows-only: Trip/DMT presets, hueDrift/spinTrail/warp sliders, genre mapping, record-player addons, community packs, full theme architect')
    [void]$report.AppendLine('')
    [void]$report.AppendLine('| Setting | Vinyl mode | Poster mode | Play stable | Controls OK |')
    [void]$report.AppendLine('|---------|------------|-------------|-------------|-------------|')

    $settingGroups = $matrix | Group-Object Setting
    foreach ($group in $settingGroups) {
        $vinylRow = $group.Group | Where-Object { $_.HeroMode -eq 'vinyl-shades' } | Select-Object -First 1
        $posterRow = $group.Group | Where-Object { $_.HeroMode -eq 'album-cover' } | Select-Object -First 1
        $vinylPlay = if ($vinylRow) { $vinylRow.Play -eq 'PASS' -and $vinylRow.Progress -eq 'PASS' } else { $false }
        $posterPlay = if ($posterRow) { $posterRow.Play -eq 'PASS' -and $posterRow.Progress -eq 'PASS' } else { $false }
        $ctrl = '-'
        [void]$report.AppendLine("| $($group.Name) | $(if ($vinylPlay) { 'PASS' } else { 'FAIL' }) | $(if ($posterPlay) { 'PASS' } else { 'FAIL' }) | $(if ($vinylPlay -and $posterPlay) { 'PASS' } else { 'FAIL' }) | $ctrl |")
    }
    foreach ($c in $controlRows) {
        [void]$report.AppendLine("| controls | $(if ($c.HeroMode -eq 'vinyl-shades') { $c.Controls } else { '-' }) | $(if ($c.HeroMode -eq 'album-cover') { $c.Controls } else { '-' }) | PASS | $($c.Controls) |")
    }

    [void]$report.AppendLine('')
    [void]$report.AppendLine('| Setting | HeroMode | Track | Play | Progress | Notes |')
    [void]$report.AppendLine('|---------|----------|-------|------|----------|-------|')
    foreach ($r in $matrix) {
        [void]$report.AppendLine("| $($r.Setting) | $($r.HeroMode) | $($r.Track) | $($r.Play) | $($r.Progress) | $($r.Notes) |")
    }

    $passRows = @($matrix | Where-Object { $_.Play -eq 'PASS' -and $_.Progress -eq 'PASS' })
    $failRows = @($matrix | Where-Object { $_.Play -ne 'PASS' -or $_.Progress -ne 'PASS' })
    $ctrlPass = @($controlRows | Where-Object { $_.Controls -eq 'PASS' }).Count -eq $controlRows.Count
    $ready = $probeOk -and ($failRows.Count -eq 0) -and $ctrlPass -and (-not $firstFail)

    [void]$report.AppendLine('')
    [void]$report.AppendLine("## Summary: $($passRows.Count)/$($matrix.Count) playback cases PASS")
    [void]$report.AppendLine("- DOM probe (no Trip/DMT): $(if ($probeOk) { 'PASS' } else { 'FAIL' })")
    [void]$report.AppendLine("- Controls: $(if ($ctrlPass) { 'PASS' } else { 'FAIL' })")
    if ($firstFail) { [void]$report.AppendLine("- First failure: $firstFail") }
    [void]$report.AppendLine('')
    [void]$report.AppendLine('## Recommendation')
    [void]$report.AppendLine("- Ready for phone install: $(if ($ready) { 'YES' } else { 'NO' })")

    $reportText = $report.ToString()
    Set-Content -Path $ReportFile -Value $reportText -Encoding UTF8
    Write-Host ''
    Write-Host $reportText
    Write-Host "Report saved: $ReportFile"

    if (-not $ready) { exit 1 }
    exit 0
} finally {
    Remove-Item $EmulatorLockFile -Force -ErrorAction SilentlyContinue
}
