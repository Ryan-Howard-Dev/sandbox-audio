# Verify single-track advance does not loop same song (device 46349770).
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"
$Serial = '46349770'
$EmuSerial = $Serial
$Package = 'rd.sheepskin.sandboxmusic'

function Get-Log {
    param([int]$Tail = 12000)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try { return (& adb.exe -s $Serial logcat -d -t $Tail 2>$null | Out-String) }
    finally { $ErrorActionPreference = $prev }
}

function WaitM($Pattern, $TimeoutSec = 180) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-Log
        if ($chunk -match $Pattern) { return $true, $Matches[0].Trim() }
        Start-Sleep -Seconds 2
    }
    return $false, 'timeout'
}

function Wait-HandlersReady {
    param([int]$TimeoutSec = 360)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-Log
        if ($chunk -match 'AREA=handlers-probe RESULT=PASS') { return $true, $Matches[0].Trim() }
        Start-E2eDeepLink -Path 'probe-handlers'
        Start-Sleep -Seconds 4
    }
    return $false, 'timeout'
}

& adb.exe -s $Serial logcat -c | Out-Null
& adb.exe -s $Serial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
& adb.exe -s $Serial shell am start -W -n "$Package/.MainActivity" | Out-Null
Start-Sleep -Seconds 8
& adb.exe -s $Serial shell input tap 540 1200 | Out-Null
Start-Sleep -Seconds 3
Start-E2eDeepLink -Path 'skip-onboarding'
$null = WaitM 'AREA=onboarding RESULT=PASS' 120
$handlersOk, $handlersLine = Wait-HandlersReady 360
if (-not $handlersOk) { throw "handlers not ready: $handlersLine" }
Write-Host "Handlers: $handlersLine" -ForegroundColor DarkGray
Start-Sleep -Seconds 5

$encA = [uri]::EscapeDataString('21 Savage')
$encAl = [uri]::EscapeDataString('American Dream')

& adb.exe -s $Serial logcat -c | Out-Null
Start-E2eDeepLink -Path 'reset-playback'
$null = WaitM 'AREA=reset-playback RESULT=PASS' 30

# Play 3 distinct locker tracks sequentially
$tracks = [uri]::EscapeDataString('Redrum|All Of Me|Sneaky')
Start-E2eDeepLink -Path "play-locker-sequence?artist=$encA&album=$encAl&tracks=$tracks"
$ok, $seqLine = WaitM 'AREA=locker-sequence RESULT=PASS' 600
Write-Host "SEQUENCE: ok=$ok $seqLine"

# Single Sked from another album — track radio must build multi-track queue
Start-E2eDeepLink -Path 'reset-playback'
$null = WaitM 'AREA=reset-playback RESULT=PASS' 30
$encSked = [uri]::EscapeDataString('Sked')
$encSkedAl = [uri]::EscapeDataString('SOUTH VOL. 2')
Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encSked&album=$encSkedAl"
$okPlay, $playLine = WaitM 'AREA=play-offline RESULT=PASS' 180
Start-Sleep -Seconds 20
Start-E2eDeepLink -Path 'probe-track-radio'
$radioOk, $radioLine = WaitM 'AREA=probe-track-radio RESULT=PASS' 90
Write-Host "SINGLE+RAD: play=$okPlay radio=$radioOk $radioLine"

# Redrum single — stale repeat-all must not re-loop same track at end
Start-E2eDeepLink -Path 'reset-playback'
$null = WaitM 'AREA=reset-playback RESULT=PASS' 30
$encRed = [uri]::EscapeDataString('Redrum')
Start-E2eDeepLink -Path "play-offline?artist=$encA&track=$encRed&album=$encAl"
$okRed, $redLine = WaitM 'AREA=play-offline RESULT=PASS' 180
Start-Sleep -Seconds 20
Start-E2eDeepLink -Path 'probe-track-radio'
$radio2Ok, $radio2Line = WaitM 'AREA=probe-track-radio RESULT=PASS' 90
$radioTitles = if ($radio2Line -match 'titles=([^ ]+)') { $Matches[1] } else { '' }
$distinctRadio = ($radioTitles -split '\|' | Where-Object { $_ } | Select-Object -Unique).Count
Write-Host "REDRUM+RAD: play=$okRed radio=$radio2Ok distinct=$distinctRadio $radio2Line"

if (-not $ok -or -not $okPlay -or -not $radioOk -or -not $okRed -or -not $radio2Ok -or $distinctRadio -lt 2) { exit 1 }
Write-Host 'ADVANCE-VERIFY PASS — 3-track sequence + 2 singles built multi-track radio (no lone-track loop)'
