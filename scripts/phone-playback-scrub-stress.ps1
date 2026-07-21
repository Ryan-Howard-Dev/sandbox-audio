# Physical device: pause/scrub/skip stress via E2E deep links (adb logcat assertions).
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild,
    [string]$Artist = '',
    [string]$Track = ''
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$Package = 'rd.sheepskin.sandboxmusic'
$EmuSerial = $Serial
$ApkRel = 'android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk'

function Wait-E2eResult {
    param([string]$Area, [int]$TimeoutSec = 300)
    $pattern = "SandboxE2E.*AREA=$Area RESULT=(PASS|FAIL)"
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = & adb.exe -s $EmuSerial logcat -d -t 12000 2>$null | Out-String
        if ($chunk -match "SandboxE2E.*AREA=$Area RESULT=PASS") {
            $m = [regex]::Match($chunk, "SandboxE2E.*AREA=$Area RESULT=PASS[^\r\n]*")
            return @{ Ok = $true; Line = $m.Value.Trim() }
        }
        if ($chunk -match "SandboxE2E.*AREA=$Area RESULT=FAIL") {
            $m = [regex]::Match($chunk, "SandboxE2E.*AREA=$Area RESULT=FAIL[^\r\n]*")
            return @{ Ok = $false; Line = $m.Value.Trim() }
        }
        Start-Sleep -Seconds 2
    }
    return @{ Ok = $false; Line = "timeout waiting for $Area" }
}

$state = & adb.exe -s $Serial get-state 2>&1
if ($state -ne 'device') { throw "Device $Serial not ready (state=$state)" }

if (-not $SkipBuild) {
    Write-Host 'Building arm64 debug APK...'
    npm run build:android:apk
}

$apk = Join-Path $Root $ApkRel
if (-not (Test-Path $apk)) { throw "APK not found: $apk" }

& adb.exe -s $EmuSerial install -r $apk | Out-Null
& adb.exe -s $EmuSerial logcat -c | Out-Null
& adb.exe -s $EmuSerial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2

& adb.exe -s $EmuSerial shell "am start -n $Package/.MainActivity" | Out-Null
$readyDeadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $readyDeadline) {
    $chunk = & adb.exe -s $EmuSerial logcat -d -t 4000 2>$null | Out-String
    if ($chunk -match 'SandboxE2E.*AREA=handlers RESULT=PASS') { break }
    Start-Sleep -Seconds 2
}

Start-E2eDeepLink -Path 'skip-onboarding'
Start-Sleep -Seconds 8
Start-E2eDeepLink -Path 'clear-server'
Start-Sleep -Seconds 2

$pick = Get-PhoneFreshTrack -Artist $Artist -Track $Track
$ArtistEnc = [uri]::EscapeDataString($pick.Artist)
$TrackEnc = [uri]::EscapeDataString($pick.Track)
Write-Host ('Scrub stress track: {0} - {1}' -f $pick.Artist, $pick.Track) -ForegroundColor Cyan

$results = @{}

$playPath = 'play-artist-track?artist={0}&track={1}&progressSeconds=15&integritySeconds=0' -f $ArtistEnc, $TrackEnc
Start-E2eDeepLink -Path $playPath
$r = Wait-E2eResult -Area 'artist-track-play' -TimeoutSec 360
$results['Play track'] = $r.Ok
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Red }

Start-E2eDeepLink -Path 'wait-progress?seconds=12'
$r = Wait-E2eResult -Area 'playback-progress' -TimeoutSec 180
$results['Progress 12s'] = $r.Ok
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Red }

Start-E2eDeepLink -Path 'playback-scrub-stress?minPos=10&cycles=3'
$r = Wait-E2eResult -Area 'playback-scrub-stress' -TimeoutSec 300
$results['Scrub + pause stress'] = $r.Ok
Write-Host $r.Line

Start-E2eDeepLink -Path 'playback-pause-resume?minPos=8'
Start-Sleep -Seconds 3
$r = Wait-E2eResult -Area 'playback-pause-resume' -TimeoutSec 180
$results['Pause resume'] = $r.Ok
Write-Host $r.Line

Start-E2eDeepLink -Path 'test-hero-controls?mode=vinyl-shades'
$r = Wait-E2eResult -Area 'hero-controls' -TimeoutSec 120
$results['Hero controls + seek'] = $r.Ok
Write-Host $r.Line

Write-Host ''
Write-Host "=== PHONE SCRUB STRESS ($Serial) ===" -ForegroundColor Cyan
$allPass = $true
foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
    $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
    $color = if ($kv.Value) { 'Green' } else { 'Red' }
    Write-Host "$mark  $($kv.Key)" -ForegroundColor $color
    if (-not $kv.Value) { $allPass = $false }
}

$logPath = Join-Path $Root '.phone-scrub-stress-log.txt'
& adb.exe -s $EmuSerial logcat -d -t 20000 2>$null | Out-String | Set-Content -Path $logPath -Encoding UTF8
Write-Host "Log: $logPath"

if (-not $allPass) { exit 1 }
exit 0
