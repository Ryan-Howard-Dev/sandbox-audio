# Physical device: background/foreground lifecycle stress — vinyl + mini player must survive resume.
param(
    [string]$Serial = '46349770',
    [switch]$SkipBuild,
    [int]$Cycles = 5,
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
$Activity = "$Package/.MainActivity"

function Wait-E2eResult {
    param([string]$Area, [int]$TimeoutSec = 300)
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

function Invoke-BackgroundForeground {
    & adb.exe -s $EmuSerial shell input keyevent 3 | Out-Null
    Start-Sleep -Seconds 2
    & adb.exe -s $EmuSerial shell "am start -n $Activity -f 0x14000000" | Out-Null
    Start-Sleep -Seconds 3
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

& adb.exe -s $EmuSerial shell "am start -n $Activity" | Out-Null
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
Write-Host ('Lifecycle stress track: {0} - {1}' -f $pick.Artist, $pick.Track) -ForegroundColor Cyan

$results = @{}

$playPath = 'play-artist-track?artist={0}&track={1}&progressSeconds=15&integritySeconds=0' -f $ArtistEnc, $TrackEnc
Start-E2eDeepLink -Path $playPath
$r = Wait-E2eResult -Area 'artist-track-play' -TimeoutSec 360
$results['Play track'] = $r.Ok
if (-not $r.Ok) {
    Write-Host $r.Line -ForegroundColor Red
    throw 'Cannot continue lifecycle stress without playback'
}

Start-E2eDeepLink -Path 'wait-progress?seconds=10'
$r = Wait-E2eResult -Area 'playback-progress' -TimeoutSec 180
$results['Wait progress'] = $r.Ok
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Red }

Start-E2eDeepLink -Path 'navigate?tab=home'
$r = Wait-E2eResult -Area 'navigation' -TimeoutSec 30
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Yellow }
Start-Sleep -Seconds 2

Start-E2eDeepLink -Path 'probe-mobile-home-chrome?minVinylPx=96'
$r = Wait-E2eResult -Area 'mobile-home-chrome' -TimeoutSec 60
$results['Pre-cycle chrome'] = $r.Ok
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Red }

for ($i = 1; $i -le $Cycles; $i++) {
    Write-Host "=== Background/foreground cycle $i / $Cycles ===" -ForegroundColor Cyan
    Invoke-BackgroundForeground
    Start-E2eDeepLink -Path 'probe-mobile-home-chrome?minVinylPx=96'
    $r = Wait-E2eResult -Area 'mobile-home-chrome' -TimeoutSec 90
    $key = "Cycle $i chrome"
    $results[$key] = $r.Ok
    if ($r.Ok) {
        Write-Host $r.Line -ForegroundColor Green
    } else {
        Write-Host $r.Line -ForegroundColor Red
    }
}

Start-E2eDeepLink -Path 'app-lifecycle-stress?cycles=2&minVinylPx=96'
$r = Wait-E2eResult -Area 'app-lifecycle-stress' -TimeoutSec 120
$results['JS lifecycle sim'] = $r.Ok
if (-not $r.Ok) { Write-Host $r.Line -ForegroundColor Red } else { Write-Host $r.Line -ForegroundColor Green }

Write-Host ''
Write-Host '=== Lifecycle stress summary ===' -ForegroundColor Cyan
$allPass = $true
foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
    $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
    $color = if ($kv.Value) { 'Green' } else { 'Red' }
    if (-not $kv.Value) { $allPass = $false }
    Write-Host "$mark  $($kv.Key)" -ForegroundColor $color
}

if (-not $allPass) {
    Write-Host 'Lifecycle stress FAILED' -ForegroundColor Red
    exit 1
}
Write-Host 'Lifecycle stress PASSED' -ForegroundColor Green
exit 0
