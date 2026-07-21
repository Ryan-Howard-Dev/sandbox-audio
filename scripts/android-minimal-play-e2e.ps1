# Minimal play E2E — ONE track (KING) + 30s progress, emulator-5554 only
param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"

$EmuSerial = 'emulator-5554'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'

function Invoke-Adb {
    param([string[]]$Command)
    Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command
    & adb.exe -s $EmuSerial @Command
    if ($LASTEXITCODE -ne 0) { throw ("adb failed: " + ($Command -join ' ')) }
}

function Get-LogcatChunk { param([int]$Tail = 12000)
    $raw = & adb.exe -s $EmuSerial logcat -d -t $Tail 2>$null
    if ($null -eq $raw) { return '' }
    if ($raw -is [array]) { return ($raw -join "`n") }
    return [string]$raw
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk
        $m = [regex]::Match($chunk, $Pattern)
        if ($m.Success) { return $true, $m.Value }
        Start-Sleep -Seconds 2
    }
    return $false, ''
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    & adb.exe -s $EmuSerial shell "am start -a android.intent.action.VIEW -d '$uri' $Package" | Out-Null
}

function Invoke-E2e {
    param([string]$Path, [string]$WaitPattern, [int]$TimeoutSec = 120)
    Invoke-DeepLink $Path
    Start-Sleep -Seconds 2
    if (-not $WaitPattern) { return $true, '' }
    return (Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec)
}

function Wait-AppReady {
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk -Tail 3000
        if ($chunk -match 'Loading app at https://localhost' -or $chunk -match 'App started') {
            Start-Sleep -Seconds 10
            return
        }
        Start-Sleep -Seconds 2
    }
    Start-Sleep -Seconds 15
}

if (Test-Path $EmulatorLockFile) { Remove-Item -Force $EmulatorLockFile }
Set-Content -Path $EmulatorLockFile -Value "$PID minimal" -Encoding ASCII
try {
    $devices = (& adb.exe devices 2>$null) -join "`n"
    if ($devices -notmatch "${EmuSerial}\s+device") { throw "Emulator $EmuSerial not online" }

    if (-not $SkipBuild) {
        $apkPath = Join-Path $Root $ApkRel
        if (-not (Test-Path $apkPath)) { npm run build:android:apk }
    }

    $apk = Join-Path $Root $ApkRel
    Invoke-Adb @('install', '-r', $apk) | Out-Null
    Invoke-Adb @('logcat', '-c') | Out-Null
    Invoke-Adb @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 2
    Invoke-Adb @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
    Invoke-Adb @('logcat', '-c') | Out-Null
    Wait-AppReady

    foreach ($step in @(
        @{ Path = 'skip-onboarding'; Pattern = 'SandboxE2E.*AREA=onboarding RESULT=PASS'; Timeout = 45 }
        @{ Path = 'probe-bridge'; Pattern = 'SandboxE2E.*AREA=bridge-probe RESULT=PASS'; Timeout = 60 }
        @{ Path = 'probe-handlers'; Pattern = 'SandboxE2E.*AREA=handlers-probe RESULT=PASS'; Timeout = 90 }
        @{ Path = 'clear-server'; Pattern = 'SandboxE2E.*AREA=server-url RESULT=PASS'; Timeout = 45 }
        @{ Path = 'check-ytdlp'; Pattern = 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS'; Timeout = 180 }
    )) {
        $ok, $line = Invoke-E2e $step.Path $step.Pattern $step.Timeout
        if (-not $ok) { throw "Bootstrap failed: $($step.Path)" }
        Write-Host "  PASS $($step.Path)"
    }

    Invoke-Adb @('logcat', '-c') | Out-Null
    $amp = [char]38
    $playPath = "play-album-track?artist=Kanye%20West${amp}album=Bully${amp}track=KING${amp}progressSeconds=30${amp}integritySeconds=0"
    Write-Host "Playing KING (yt-dlp may take several minutes on first resolve) ..."
    $null = Invoke-E2e $playPath 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)' 720

    $chunk = Get-LogcatChunk -Tail 20000
    $playOk = [regex]::IsMatch($chunk, 'SandboxE2E.*AREA=album-track-play RESULT=PASS')
    $progOk = [regex]::IsMatch($chunk, 'SandboxE2E.*AREA=playback-progress RESULT=PASS')
    $playLine = ([regex]::Matches($chunk, 'SandboxE2E.*AREA=album-track-play RESULT=(PASS|FAIL)')) | Select-Object -Last 1
    $progLine = ([regex]::Matches($chunk, 'SandboxE2E.*AREA=playback-progress RESULT=(PASS|FAIL)')) | Select-Object -Last 1

    Write-Host ''
    Write-Host "album-track-play: $(if ($playOk) { 'PASS' } else { 'FAIL' })"
    if ($playLine) { Write-Host "  $($playLine.Value)" }
    Write-Host "playback-progress: $(if ($progOk) { 'PASS' } else { 'FAIL' })"
    if ($progLine) { Write-Host "  $($progLine.Value)" }

    Set-Content -Path (Join-Path $Root '.minimal-play-logcat.txt') -Value $chunk -Encoding UTF8

    if (-not ($playOk -and $progOk)) { exit 1 }
    Write-Host ''
    Write-Host 'MINIMAL VERIFY: PASS' -ForegroundColor Green
    exit 0
} finally {
    if (Test-Path $EmulatorLockFile) { Remove-Item -Force $EmulatorLockFile -ErrorAction SilentlyContinue }
}
