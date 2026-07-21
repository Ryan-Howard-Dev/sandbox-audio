# Sandbox Music — download + cache E2E (Android emulator ONLY)
# Usage: .\scripts\android-download-cache-e2e.ps1
#        .\scripts\android-download-cache-e2e.ps1 -QuickMode
# NEVER installs to physical devices — emulator-5554 only.

param(
    [switch]$QuickMode
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
$Album = 'Bully'
$SingleTrack = 'KING'
$SingleAlbum = 'Bully'
$AlbumTrack = 'FATHER'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'
$LogcatFile = Join-Path $Root '.download-cache-logcat.txt'
$ReportFile = Join-Path $Root '.download-cache-report.txt'

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

function Wait-EmulatorE2eLock {
    param([int]$MaxWaitSec = 900)
    if (-not (Test-Path $EmulatorLockFile)) { return }
    $deadline = (Get-Date).AddSeconds($MaxWaitSec)
    while ((Test-Path $EmulatorLockFile) -and (Get-Date) -lt $deadline) {
        Write-Host "Emulator E2E lock present — waiting 30s ..." -ForegroundColor Yellow
        Start-Sleep -Seconds 30
    }
    if (Test-Path $EmulatorLockFile) {
        throw "Emulator E2E lock still held after ${MaxWaitSec}s"
    }
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    & adb.exe -s $EmuSerial shell "am start -a android.intent.action.VIEW -d '$uri' -f 0x14000000 $Package" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("adb deep link failed: $uri") }
}

function Get-LogcatChunk {
    param([int]$Tail = 12000)
    & adb.exe -s $EmuSerial logcat -d -t $Tail 2>$null
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
    Invoke-DeepLink $Path
    Start-Sleep -Seconds 2
    if (-not $WaitPattern) { return $false, '' }
    return Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
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

function Add-Result {
    param([string]$Test, [bool]$Pass, [string]$Notes = '')
    $script:Results.Add([pscustomobject]@{
        Test   = $Test
        Result = if ($Pass) { 'PASS' } else { 'FAIL' }
        Notes  = $Notes
    })
}

$Results = [System.Collections.Generic.List[object]]::new()

Wait-EmulatorE2eLock
Assert-EmulatorOnly
Start-EmulatorIfNeeded
Assert-EmulatorOnly

$lockCreated = $false
try {
    Set-Content -Path $EmulatorLockFile -Value "$PID download-cache-e2e $(Get-Date -Format o)" -Encoding UTF8
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
Write-Host 'Cold-starting app with skip-onboarding deep link ...'
Invoke-Adb -Command @(
    'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
    '-d', 'sandboxmusic://e2e/skip-onboarding',
    $Package
) | Out-Null
Start-Sleep -Seconds 12
$null = Invoke-E2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45
$null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
$null = Invoke-E2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 150

$encArtist = [uri]::EscapeDataString($Artist)
$encAlbum = [uri]::EscapeDataString($Album)
$encSingle = [uri]::EscapeDataString($SingleTrack)
$encAlbumTrack = [uri]::EscapeDataString($AlbumTrack)

Write-Host ''
Write-Host '=== A. Single track download ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
$encSingleAlbum = [uri]::EscapeDataString($SingleAlbum)
$singlePath = "download-track?artist=$encArtist" + '&album=' + $encSingleAlbum + '&title=' + $encSingle + '&mode=tracks'
$singleOk = (Invoke-E2e $singlePath 'SandboxE2E.*AREA=download-track RESULT=PASS' 900)[0]
Add-Result 'Single download' $singleOk $(if ($singleOk) { '' } else { 'download-track timeout' })

if ($singleOk) {
    $verifySingle = (Invoke-E2e "verify-locker-cache?artist=$encArtist&title=$encSingle" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 30)[0]
    Add-Result 'Single locker verify' $verifySingle
}

Write-Host ''
Write-Host '=== B. Album track download (same track, album mode) ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
$albumTrackPath = "download-track?artist=$encArtist" + '&album=' + $encAlbum + '&title=' + $encAlbumTrack + '&mode=album'
$albumTrackOk = (Invoke-E2e $albumTrackPath 'SandboxE2E.*AREA=download-track RESULT=PASS' 900)[0]
Add-Result 'Album-mode single track' $albumTrackOk

if ($albumTrackOk) {
    $verifyAlbumTrack = (Invoke-E2e "verify-locker-cache?artist=$encArtist&title=$encAlbumTrack&album=$encAlbum" 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 30)[0]
    Add-Result 'Album track locker verify' $verifyAlbumTrack
}

if (-not $QuickMode) {
    Write-Host ''
    Write-Host "=== B2. Full album download ($Album) ===" -ForegroundColor Cyan
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $albumPath = "download-album?artist=$encArtist" + '&album=' + $encAlbum
    $albumOk = (Invoke-E2e $albumPath 'SandboxE2E.*AREA=download-album RESULT=PASS' 3600)[0]
    Add-Result 'Album download' $albumOk $(if ($QuickMode) { 'skipped quick mode' } else { '' })
} else {
    Add-Result 'Album download' $true 'SKIP quick mode'
}

Write-Host ''
Write-Host '=== Offline cached play ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
$null = Invoke-E2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 30
$offlinePath = "play-offline?artist=$encArtist" + '&track=' + $encSingle + '&album=' + $encSingleAlbum
$offlineOk = (Invoke-E2e $offlinePath 'SandboxE2E.*AREA=play-offline RESULT=PASS' 180)[0]
Add-Result 'Offline cached play' $offlineOk

Write-Host ''
Write-Host '=== Art cache ===' -ForegroundColor Cyan
$artPath = "verify-art-cache?artist=$encArtist" + '&title=' + $encAlbumTrack + '&album=' + $encAlbum
$artOk = (Invoke-E2e $artPath 'SandboxE2E.*AREA=verify-art-cache RESULT=PASS' 60)[0]
Add-Result 'Art cache' $artOk

Write-Host ''
Write-Host '=== Stream cache hit ===' -ForegroundColor Cyan
Invoke-Adb -Command @('logcat', '-c') | Out-Null
$null = Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20
$streamPath = "verify-stream-cache?artist=$encArtist" + '&track=' + $encSingle
$streamOk = (Invoke-E2e $streamPath 'SandboxE2E.*AREA=verify-stream-cache RESULT=PASS' 420)[0]
Add-Result 'Stream cache hit' $streamOk

& adb.exe -s $EmuSerial logcat -d > $LogcatFile

$report = New-Object System.Text.StringBuilder
[void]$report.AppendLine('# Download + Cache E2E Report - Android Emulator')
[void]$report.AppendLine("Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$report.AppendLine(('Device: {0} (emulator only; phone {1} NOT used)' -f $EmuSerial, $ForbiddenSerial))
[void]$report.AppendLine('')
[void]$report.AppendLine('| Test | Result | Notes |')
[void]$report.AppendLine('|------|--------|-------|')
foreach ($r in $Results) {
    [void]$report.AppendLine("| $($r.Test) | $($r.Result) | $($r.Notes) |")
}

$failCount = @($Results | Where-Object { $_.Result -ne 'PASS' }).Count
$ready = $failCount -eq 0
[void]$report.AppendLine('')
[void]$report.AppendLine("## Overall: $(if ($ready) { 'PASS' } else { 'FAIL' }) ($failCount failures)")
[void]$report.AppendLine('')
[void]$report.AppendLine('## Recommendation')
[void]$report.AppendLine("- Ready for phone install: $(if ($ready) { 'YES' } else { 'NO' })")

$text = $report.ToString()
Set-Content -Path $ReportFile -Value $text -Encoding UTF8
Write-Host ''
Write-Host $text
Write-Host "Report: $ReportFile"
Write-Host "Logcat: $LogcatFile"

if (-not $ready) { exit 1 }
exit 0
} finally {
    if ($lockCreated -and (Test-Path $EmulatorLockFile)) {
        Remove-Item $EmulatorLockFile -Force -ErrorAction SilentlyContinue
    }
}
