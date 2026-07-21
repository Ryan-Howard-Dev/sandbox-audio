# Focused Kanye/Bully playback validation on emulator (assumes AVD running).
param(
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
. "$PSScriptRoot\set-android-env.ps1"
. "$PSScriptRoot\_e2e-android-hardening.ps1"

$EmuSerial = 'emulator-5554'
$Package = 'rd.sheepskin.sandboxmusic'
$ApkRel = 'android\app\build\outputs\apk\debug\app-x86_64-debug.apk'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'
Stop-CompetingAndroidE2e
Clear-StaleE2eEmulatorLock $EmulatorLockFile

function Invoke-DeepLink {
    param([string]$Path)
    Start-E2eDeepLink -Path $Path
    Start-Sleep -Seconds 2
}

function Wait-LogcatMatch {
    param([string]$Pattern, [int]$TimeoutSec = 180)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = & adb.exe -s $EmuSerial logcat -d -s 'Capacitor/Console:*' -t 15000 2>$null
        if ($chunk -match $Pattern) { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

if (-not $SkipBuild) {
    Write-Host 'Building x86_64 debug APK...'
    npm run build:android:apk
} else {
    Write-Host 'SkipBuild: using existing APK'
}
$apk = Join-Path $Root $ApkRel
& adb.exe -s $EmuSerial install -r $apk | Out-Null

Write-Host 'Cold-starting app and waiting for E2E bridge...'
& adb.exe -s $EmuSerial logcat -c | Out-Null
& adb.exe -s $EmuSerial shell am force-stop $Package | Out-Null
Start-Sleep -Seconds 2
Start-E2eDeepLink -Path 'skip-onboarding'
Start-Sleep -Seconds 20
if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=onboarding RESULT=PASS' -TimeoutSec 90)) {
    throw 'Bootstrap failed: skip-onboarding'
}
if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' -TimeoutSec 120)) {
    Start-E2eDeepLink -Path 'probe-handlers'
    Start-Sleep -Seconds 3
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' -TimeoutSec 90)) {
        throw 'Bootstrap failed: E2E handlers not registered'
    }
}

Write-Host 'Configuring app for mobile-only playback...'
Invoke-DeepLink 'clear-server'
Start-Sleep -Seconds 1
Invoke-DeepLink 'check-ytdlp'
Start-Sleep -Seconds 8

$results = @{}
$KanyeArtist = [uri]::EscapeDataString('Kanye West')
$KanyeAlbum = [uri]::EscapeDataString('Bully')
$KanyeTrackFather = [uri]::EscapeDataString('FATHER')
$KanyeTrackKing = [uri]::EscapeDataString('KING')
$KanyeTrackPreacher = [uri]::EscapeDataString('PREACHER MAN')
function Get-LatestAlbumTrackTitles {
    param([int]$Count = 3)
    $chunk = & adb.exe -s $EmuSerial logcat -d -s 'Capacitor/Console:*' -t 12000 2>$null
    $m = [regex]::Match($chunk, 'AREA=album-tracks RESULT=PASS count=\d+ tracks=([^\r\n]+)')
    if (-not $m.Success) { return @() }
    return @(($m.Groups[1].Value -split '\|') | Select-Object -First $Count)
}

function Test-AlbumTrackSequence {
    param(
        [string]$ArtistEncoded,
        [string]$AlbumEncoded,
        [int]$Count = 3,
        [int]$PerTrackTimeoutSec = 360
    )
    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    & adb.exe -s $EmuSerial logcat -c | Out-Null
    Invoke-DeepLink "open-album?artist=$ArtistEncoded&album=$AlbumEncoded"
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=open-album RESULT=PASS' -TimeoutSec 180)) {
        return $false
    }
    Invoke-DeepLink 'list-album-tracks'
    if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=album-tracks RESULT=PASS' -TimeoutSec 60)) {
        Write-Host 'Album track list E2E failed' -ForegroundColor Red
        return $false
    }
    $titles = Get-LatestAlbumTrackTitles -Count $Count
    if ($titles.Count -lt $Count) {
        Write-Host "Album track list incomplete (got $($titles.Count), need $Count)" -ForegroundColor Yellow
        return $false
    }
    foreach ($title in $titles) {
        $trackEnc = [uri]::EscapeDataString($title)
        Invoke-DeepLink 'stop-exo'
        Start-Sleep -Seconds 2
        & adb.exe -s $EmuSerial logcat -c | Out-Null
        Invoke-DeepLink "play-album-track?artist=$ArtistEncoded&album=$AlbumEncoded&track=$trackEnc&progressSeconds=3"
        if (-not (Wait-LogcatMatch 'SandboxE2E.*AREA=album-track-play RESULT=PASS' -TimeoutSec $PerTrackTimeoutSec)) {
            Write-Host "Album sequence failed on track: $title" -ForegroundColor Red
            return $false
        }
    }
    return $true
}

Invoke-DeepLink 'stop-exo'
Start-Sleep -Seconds 2
& adb.exe -s $EmuSerial logcat -c | Out-Null
Invoke-DeepLink "play-artist-track?artist=$KanyeArtist&track=$KanyeTrackFather"
$results['FATHER tap'] = Wait-LogcatMatch 'SandboxE2E.*AREA=artist-track-play RESULT=PASS' -TimeoutSec 300

Invoke-DeepLink 'stop-exo'
Start-Sleep -Seconds 2
& adb.exe -s $EmuSerial logcat -c | Out-Null
Invoke-DeepLink "play-album-track?artist=$KanyeArtist&album=$KanyeAlbum&track=$KanyeTrackKing"
$results['KING/Bully album'] = Wait-LogcatMatch 'SandboxE2E.*AREA=album-track-play RESULT=PASS' -TimeoutSec 300
if (-not $results['KING/Bully album']) {
    Invoke-DeepLink 'stop-exo'
    Start-Sleep -Seconds 2
    & adb.exe -s $EmuSerial logcat -c | Out-Null
    Invoke-DeepLink "play-album-track?artist=$KanyeArtist&album=$KanyeAlbum&track=$KanyeTrackPreacher"
    $results['KING/Bully album'] = Wait-LogcatMatch 'SandboxE2E.*AREA=album-track-play RESULT=PASS' -TimeoutSec 300
}

Write-Host 'Album 3-track sequence (sequential album taps)...'
$results['Album 3-track'] = Test-AlbumTrackSequence -ArtistEncoded $KanyeArtist -AlbumEncoded $KanyeAlbum -Count 3

Invoke-DeepLink 'stop-exo'
Start-Sleep -Seconds 2
Invoke-DeepLink 'clear-server'
Start-Sleep -Seconds 2
& adb.exe -s $EmuSerial logcat -c | Out-Null
Invoke-DeepLink "play-artist-track?artist=$KanyeArtist&track=$KanyeTrackFather&progressSeconds=25"
$results['Progress 25s'] = Wait-LogcatMatch 'SandboxE2E.*AREA=playback-progress RESULT=PASS' -TimeoutSec 300

Invoke-DeepLink 'stop-exo'
Start-Sleep -Seconds 2
Invoke-DeepLink 'navigate?tab=home'
Start-Sleep -Seconds 5
Invoke-DeepLink 'set-vinyl-mode?mode=album-cover'
Start-Sleep -Seconds 3
Invoke-DeepLink 'probe-vinyl?mode=album-cover'
$coverOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=album-cover.*visual=poster' -TimeoutSec 45
Invoke-DeepLink 'toggle-vinyl-ui'
Start-Sleep -Seconds 2
Invoke-DeepLink 'probe-vinyl?mode=vinyl-shades'
$vinylOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=vinyl-shades.*visual=vinyl' -TimeoutSec 45
Invoke-DeepLink 'toggle-vinyl-ui'
Start-Sleep -Seconds 2
Invoke-DeepLink 'probe-vinyl?mode=album-cover'
$posterOk = Wait-LogcatMatch 'SandboxE2E.*AREA=vinyl-mode RESULT=PASS.*mode=album-cover.*visual=poster' -TimeoutSec 45
$results['Vinyl toggle UI'] = $coverOk -and $vinylOk -and $posterOk

& adb.exe -s $EmuSerial logcat -d -s 'Capacitor/Console:*' 'YtDlpMobile:*' 'NativeExo:*' 'AndroidRuntime:E' > (Join-Path $Root '.e2e-kanye-logcat.txt')

Write-Host ''
Write-Host '=== KANYE VALIDATION ===' -ForegroundColor Cyan
$allPass = $true
foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
    $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
    if ($kv.Value) { Write-Host "$mark  $($kv.Key)" -ForegroundColor Green }
    else { Write-Host "$mark  $($kv.Key)" -ForegroundColor Red; $allPass = $false }
}

if (-not $allPass) { exit 1 }
exit 0
