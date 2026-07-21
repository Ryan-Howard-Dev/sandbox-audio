# Physical device: playback continuity + vinyl UI toggle (real button tap).
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

function Invoke-DeepLink {
    param([string]$Path)
    Start-E2eDeepLink -Path $Path
    Start-Sleep -Seconds 2
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 240)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $state = & adb.exe -s $EmuSerial get-state 2>$null
        if ($state -ne 'device') {
            Start-Sleep -Seconds 2
            continue
        }
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = 'SilentlyContinue'
        try {
            $chunk = & adb.exe -s $EmuSerial logcat -d -t 15000 2>$null | Out-String
        } finally {
            $ErrorActionPreference = $prevEap
        }
        Update-PlaySpineSeen $chunk
        Update-PlaySpineSeen (Get-PlaySpineLogcatChunk)
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Test-PlaySpine {
    param([string]$Label = 'play-spine')
    return Test-PlaySpineAccumulated -Label $Label
}

$state = & adb.exe -s $Serial get-state 2>&1
if ($state -ne 'device') {
    $devices = & adb.exe devices 2>$null | Out-String
    throw "Device $Serial not ready (state=$state). adb devices:`n$devices"
}

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

Write-Host 'Cold-starting app ...'
& adb.exe -s $EmuSerial shell "am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n rd.sheepskin.sandboxmusic/.MainActivity" 2>&1 | Out-Null
Write-Host 'Waiting for WebView + E2E bridge ...'
$readyDeadline = (Get-Date).AddSeconds(120)
while ((Get-Date) -lt $readyDeadline) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    try {
        $chunk = & adb.exe -s $EmuSerial logcat -d -t 4000 2>$null | Out-String
    } finally {
        $ErrorActionPreference = $prevEap
    }
    $bridgeOk = $chunk -match 'SandboxE2E.*AREA=bridge RESULT=PASS'
    $handlersOk = $chunk -match 'SandboxE2E.*AREA=handlers RESULT=PASS'
    if ($bridgeOk -and $handlersOk) {
        Start-Sleep -Seconds 3
        break
    }
    Start-Sleep -Seconds 2
}
if ((Get-Date) -ge $readyDeadline) { throw 'E2E bridge/handlers not ready within 120s' }

function Invoke-BootstrapE2e {
    param([string]$LinkPath, [string]$WaitPattern, [int]$TimeoutSec = 120, [int]$Retries = 3)
    for ($i = 0; $i -lt $Retries; $i += 1) {
        Start-E2eDeepLink -Path $LinkPath
        if (Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec) { return $true }
        Write-Host "Bootstrap retry $($i + 1)/$Retries for $LinkPath" -ForegroundColor Yellow
        Start-Sleep -Seconds 5
    }
    return $false
}

if (-not (Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 60)) {
    throw 'Bootstrap failed: skip-onboarding'
}
if (-not (Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90)) {
    throw 'Bootstrap failed: E2E handlers'
}

Invoke-DeepLink 'clear-server'
$ytdlpCleared = Invoke-PhonePlaybackCacheClear

$pick = Get-PhoneFreshTrack -Artist $Artist -Track $Track
$ArtistLabel = $pick.Artist
$TrackLabel = $pick.Track
Write-Host "Fresh-resolve vinyl suite: $ArtistLabel — $TrackLabel" -ForegroundColor Cyan
if (-not $ytdlpCleared) {
    Write-Host 'WARN: ytdlp-playback cache may not be empty' -ForegroundColor Yellow
}

$results = @{}
$Artist = [uri]::EscapeDataString($ArtistLabel)
$Track = [uri]::EscapeDataString($TrackLabel)

Reset-PlaySpineSeen

function Invoke-PlaybackE2e {
    param(
        [string]$Name,
        [scriptblock]$Run,
        [int]$Retries = 2
    )
    for ($i = 0; $i -le $Retries; $i += 1) {
        if ($i -gt 0) {
            Write-Host "Retry $i/$Retries for $Name" -ForegroundColor Yellow
            Invoke-DeepLink 'stop-exo'
            Start-Sleep -Seconds 3
            & adb.exe -s $EmuSerial logcat -c | Out-Null
        }
        $ok = & $Run
        if ($ok) { return $true }
    }
    return $false
}

$results['Play 25s + integrity 45s'] = Invoke-PlaybackE2e 'Play 25s + integrity 45s' {
    Invoke-DeepLink "play-artist-track?artist=$Artist&track=$Track&progressSeconds=25&integritySeconds=45"
    $playOk = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 360
        if (-not $playOk) { return $false }
        $progressOk = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 360
        if (-not $progressOk) { return $false }
        if (-not (Test-PlaySpine -Label 'phone-play-spine').Pass) { return $false }
    $integrityOk = Wait-LogcatMatch 'SandboxE2E.*AREA=stream-integrity RESULT=PASS' -TimeoutSec 120
    if ($integrityOk) {
        $log = & adb.exe -s $EmuSerial logcat -d -t 12000 2>$null | Out-String
        try {
            Assert-PhoneFreshPlayback -LogText $log -Label 'stream-integrity' | Out-Null
        } catch {
            Write-Host $_.Exception.Message -ForegroundColor Red
            return $false
        }
    }
    $integrityOk
}

$results['Stream integrity'] = $results['Play 25s + integrity 45s']

$results['Pause resume position'] = Invoke-PlaybackE2e 'Pause resume position' {
    Invoke-DeepLink "play-artist-track?artist=$Artist&track=$Track"
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300)) { return $false }
    Invoke-DeepLink 'playback-pause-resume?minPos=10'
    Wait-LogcatMatch 'SandboxE2E.*AREA=playback-pause-resume RESULT=PASS' -TimeoutSec 180
}

$results['Home vinyl while playing'] = Invoke-PlaybackE2e 'Home vinyl while playing' {
    Invoke-DeepLink "play-artist-track?artist=$Artist&track=$Track"
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300)) { return $false }
    Invoke-DeepLink 'home-vinyl-while-playing?minPos=15'
    Wait-LogcatMatch 'SandboxE2E.*AREA=home-vinyl-playing RESULT=PASS' -TimeoutSec 120
}

$results['Mini player compact on discover'] = Invoke-PlaybackE2e 'Mini player compact on discover' {
    Invoke-DeepLink "play-artist-track?artist=$Artist&track=$Track"
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300)) { return $false }
    Invoke-DeepLink 'navigate?tab=discover'
    Start-Sleep -Seconds 3
    Invoke-DeepLink 'probe-mini-player?maxHeightPx=100&maxViewportRatio=0.14'
    Wait-LogcatMatch 'SandboxE2E.*AREA=mini-player RESULT=PASS' -TimeoutSec 45
}

$results['Play to 85% of track'] = Invoke-PlaybackE2e 'Play to 85% of track' {
    Invoke-DeepLink "play-artist-track?artist=$Artist&track=$Track"
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300)) { return $false }
    Invoke-DeepLink 'playback-fraction?fraction=0.85&timeoutMs=540000'
    Wait-LogcatMatch 'SandboxE2E.*AREA=playback-fraction RESULT=PASS' -TimeoutSec 560
}

Invoke-DeepLink 'navigate?tab=home'
Start-Sleep -Seconds 5
Invoke-DeepLink 'set-vinyl-mode?mode=album-cover'
Start-Sleep -Seconds 2
Invoke-DeepLink 'probe-vinyl?mode=album-cover'
$coverOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*visual=poster' -TimeoutSec 45
Invoke-DeepLink 'toggle-vinyl-ui'
$toggle1 = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-toggle-ui RESULT=PASS' -TimeoutSec 45
Invoke-DeepLink 'probe-vinyl?mode=vinyl-shades'
$vinylOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*visual=vinyl' -TimeoutSec 45
Invoke-DeepLink 'toggle-vinyl-ui'
$toggle2 = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-toggle-ui RESULT=PASS' -TimeoutSec 45
Invoke-DeepLink 'probe-vinyl?mode=album-cover'
$posterOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*visual=poster' -TimeoutSec 45
$results['Vinyl UI toggle both ways'] = $coverOk -and $toggle1 -and $vinylOk -and $toggle2 -and $posterOk

Write-Host ''
Write-Host "=== PHONE PLAYBACK + VINYL ($Serial) ===" -ForegroundColor Cyan
Write-Host "track: $ArtistLabel — $TrackLabel"
$logText = & adb.exe -s $EmuSerial logcat -d -t 20000 2>$null | Out-String
$logText | Set-Content -Path (Join-Path $Root '.e2e-phone-logcat.txt') -Encoding UTF8
try {
    $timing = Assert-PhoneFreshPlayback -LogText $logText -Label 'vinyl-suite'
    Write-PhoneFreshTiming -Timing $timing -Track $TrackLabel -Artist $ArtistLabel
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
$allPass = $true
foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
    $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
    if ($kv.Value) { Write-Host "$mark  $($kv.Key)" -ForegroundColor Green }
    else { Write-Host "$mark  $($kv.Key)" -ForegroundColor Red; $allPass = $false }
}

if (-not $allPass) { exit 1 }
exit 0
