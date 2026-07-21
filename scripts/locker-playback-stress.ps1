# Locker-only playback stress on physical device — proves offline vault plays via content:// URIs.
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'
$ReportPath = Join-Path $Root '.locker-playback-stress-report.json'
$LogPath = Join-Path $Root '.locker-playback-stress-logcat.txt'

$LockerTracks = @(
    @{ Artist = 'Rick Ross'; Track = 'What a Shame'; Album = 'Mastermind (Deluxe Version)' },
    @{ Artist = '21 Savage'; Track = 'Redrum'; Album = 'american dream' },
    @{ Artist = '21 Savage'; Track = 'American Dream'; Album = 'american dream' },
    @{ Artist = 'Westside Gunn'; Track = 'Flygod Did'; Album = 'And Then You Pray For Me' }
)

function Get-FullLogcat {
    param([int]$Tail = 20000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { return (& adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String) }
    finally { $ErrorActionPreference = $prev }
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat
        if ($chunk -match 'FATAL EXCEPTION.*rd\.sheepskin\.sandboxmusic') { throw 'App crash during locker stress' }
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-VaultBoot {
    $deadline = (Get-Date).AddSeconds(240)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat -Tail 12000
        if ($chunk -match 'SandboxE2E.*AREA=bridge RESULT=PASS') { return }
        if ($chunk -match '\[locker\] warmed native playback cache') { return }
        if ($chunk -match 'SandboxE2E.*AREA=handlers RESULT=PASS') { return }
        Start-Sleep -Seconds 3
    }
    Write-Host 'Vault boot wait timed out — continuing anyway' -ForegroundColor Yellow
}

function Wait-AppReady {
    Wait-VaultBoot
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-FullLogcat -Tail 8000
        if (($chunk -match 'AREA=handlers-probe RESULT=PASS') -or ($chunk -match 'AREA=handlers RESULT=PASS')) {
            Start-Sleep -Seconds 2
            return
        }
        Start-E2eDeepLink -Path 'probe-handlers' 2>$null | Out-Null
        Start-Sleep -Seconds 4
    }
    throw 'E2E handlers not ready'
}

function Invoke-Bootstrap {
    $deadline = (Get-Date).AddSeconds(300)
    $onboardOk = $false
    while ((Get-Date) -lt $deadline -and -not $onboardOk) {
        Start-E2eDeepLink -Path 'skip-onboarding'
        $onboardOk = Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' 30
        if (-not $onboardOk) { Start-Sleep -Seconds 5 }
    }
    if (-not $onboardOk) { throw 'skip-onboarding failed' }
    Start-Sleep -Seconds 3
    $handlerDeadline = (Get-Date).AddSeconds(180)
    $handlersOk = $false
    while ((Get-Date) -lt $handlerDeadline -and -not $handlersOk) {
        Start-E2eDeepLink -Path 'probe-handlers'
        $handlersOk = Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 45
        if (-not $handlersOk) { Start-Sleep -Seconds 5 }
    }
    if (-not $handlersOk) { throw 'handlers-probe failed' }
    Start-E2eDeepLink -Path 'clear-server'
    Wait-LogcatMatch 'SandboxE2E.*AREA=server-url RESULT=PASS' 30 | Out-Null
}

function Test-LockerTrack {
    param($Track)
    $encA = [uri]::EscapeDataString($Track.Artist)
    $encT = [uri]::EscapeDataString($Track.Track)
    $encAl = [uri]::EscapeDataString($Track.Album)
    $name = "locker:$($Track.Track)"
    Write-Host "`n=== $name ===" -ForegroundColor Cyan
    & adb.exe -s $Serial logcat -c | Out-Null

    Start-E2eDeepLink -Path "verify-locker-cache?artist=$encA&title=$encT&album=$encAl"
    $verifyOk = Wait-LogcatMatch 'SandboxE2E.*AREA=verify-locker-cache RESULT=PASS' 120
    $verifyLog = Get-FullLogcat -Tail 4000
    $verifyLine = if ($verifyLog -match 'SandboxE2E.*AREA=verify-locker-cache[^\n]*') { $Matches[0] } else { 'no verify log' }

    & adb.exe -s $Serial logcat -c | Out-Null
    Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encT&album=$encAl"
    $playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=play-offline RESULT=PASS' 240
    Start-Sleep -Seconds 8
    $log = Get-FullLogcat -Tail 15000
    $playLine = if ($log -match 'SandboxE2E.*AREA=play-offline[^\n]*') { $Matches[0] } else { 'no play-offline log' }
    $hasContent = $log -match 'content://rd\.sheepskin\.sandboxmusic\.locker'
    $exoPlaying = $log -match '"state"\s*:\s*"playing"' -or $log -match 'state=playing'
    $pos = 0.0
    if ($log -match '"positionSecs"\s*:\s*(\d+(?:\.\d+)?)') { $pos = [double]$Matches[1] }
    $pass = $verifyOk -and $playOk -and $hasContent -and ($exoPlaying -or $pos -gt 0.3)
    $evidence = "verify=$verifyOk play=$playOk content=$hasContent exo=$exoPlaying pos=$pos | $playLine"
    Write-Host $(if ($pass) { 'PASS' } else { 'FAIL' }) $evidence -ForegroundColor $(if ($pass) { 'Green' } else { 'Red' })
    Start-E2eDeepLink -Path 'stop-exo' | Out-Null
    Start-Sleep -Seconds 2
    return [ordered]@{ name = $name; pass = $pass; evidence = $evidence; verify = $verifyLine }
}

if ((& adb.exe -s $Serial get-state 2>&1) -ne 'device') { throw "Device $Serial not ready" }

if (-not $SkipBuild) {
    Write-Host 'Building arm64 debug APK...' -ForegroundColor Cyan
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK missing: $apk" }

Install-E2eApk -ApkPath $apk
& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& adb.exe -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Wait-AppReady
Invoke-Bootstrap

$results = @()
foreach ($t in $LockerTracks) {
    $results += Test-LockerTrack $t
}

$fullLog = Get-FullLogcat -Tail 80000
$fullLog | Set-Content -Path $LogPath -Encoding UTF8
$passCount = @($results | Where-Object { $_.pass }).Count
$report = [ordered]@{
    timestamp = (Get-Date).ToString('o')
    serial = $Serial
    passCount = $passCount
    total = $results.Count
    results = $results
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $ReportPath -Encoding UTF8

Write-Host "`n=== LOCKER PLAYBACK STRESS ===" -ForegroundColor Cyan
Write-Host "Pass: $passCount/$($results.Count)"
Write-Host "Report: $ReportPath"
foreach ($r in $results) {
    $color = if ($r.pass) { 'Green' } else { 'Red' }
    Write-Host ("{0,-40} {1}" -f $r.name, $(if ($r.pass) { 'PASS' } else { 'FAIL' })) -ForegroundColor $color
}

if ($passCount -lt $results.Count) { exit 1 }
exit 0
