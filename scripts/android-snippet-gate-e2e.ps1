# KING snippet gate — full-length playback (file:// or duration >= 90s), emulator ONLY
# Usage: .\scripts\android-snippet-gate-e2e.ps1
# NEVER installs to physical devices — emulator-5554 only.

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
$Track = 'KING'
$ResultFile = Join-Path $Root '.snippet-verify-result.txt'
$LogFile = Join-Path $Root '.snippet-verify-orchestrator.log'
$EmulatorLockFile = Join-Path $Root '.e2e-emulator.lock'
$PlayTimeoutSec = 1200

function Write-Log([string]$Message) {
    $line = "$(Get-Date -Format 'HH:mm:ss') $Message"
    Add-Content -Path $LogFile -Value $line -Encoding ASCII
    Write-Host $line
}

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
        Write-Log "Emulator already running ($EmuSerial)"
        return
    }
    Write-Log "Starting emulator $AvdName ..."
    Start-Process -FilePath 'emulator' -ArgumentList @('-avd', $AvdName, '-port', '5554', '-no-snapshot-save', '-gpu', 'swiftshader_indirect') -WindowStyle Minimized | Out-Null
    if (-not (Wait-EmulatorBoot)) { throw 'Emulator boot timeout' }
}

function Invoke-DeepLink {
    param([string]$Path)
    $uri = "sandboxmusic://e2e/$Path"
    & adb.exe -s $EmuSerial shell "am start -W -a android.intent.action.VIEW -d '$uri' $Package" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw ("adb deep link failed: $uri") }
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
        [int]$TimeoutSec = 120
    )
    Invoke-DeepLink $Path
    Start-Sleep -Seconds 3
    if (-not $WaitPattern) { return $true, '' }
    return Wait-LogcatMatch $WaitPattern -TimeoutSec $TimeoutSec
}

function Wait-AppReady {
    param([int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        $chunk = Get-LogcatChunk -Tail 3000
        if ($chunk -match 'Loading app at https://localhost' -or $chunk -match 'App started') {
            Start-Sleep -Seconds 10
            return $true
        }
        Start-Sleep -Seconds 2
    }
    Start-Sleep -Seconds 15
    return $false
}

function Invoke-BootstrapE2e {
    param(
        [string]$Path,
        [string]$WaitPattern,
        [int]$TimeoutSec = 120,
        [int]$Retries = 3
    )
    for ($i = 0; $i -lt $Retries; $i += 1) {
        Write-Log "Bootstrap: $Path"
        $ok, $line = Invoke-E2e $Path $WaitPattern $TimeoutSec
        if ($ok) {
            Write-Log "OK $Path"
            return $true
        }
        Write-Log "Bootstrap retry $($i + 1)/$Retries for $Path"
        Start-Sleep -Seconds 5
    }
    return $false
}

function Build-ApkIfStale {
    $apkPath = Join-Path $Root $ApkRel
    $srcNewer = Get-ChildItem -Path (Join-Path $Root 'src') -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not (Test-Path $apkPath)) {
        Write-Log 'APK missing - building ...'
        npm run build:android:apk
        return
    }
    if ($srcNewer -and $srcNewer.LastWriteTime -gt (Get-Item $apkPath).LastWriteTime) {
        Write-Log 'Source newer than APK - rebuilding ...'
        npm run build:android:apk
    }
}

function Set-SnippetResult {
    param(
        [string]$Overall,
        [string]$Play,
        [string]$Snippet,
        [string]$Detail
    )
    if ($Detail.Length -gt 240) { $Detail = $Detail.Substring(0, 240) + '...' }
    $text = @(
        "overall=$Overall"
        "detail=$Detail"
        "play=$Play"
        "snippet=$Snippet"
    ) -join "`n"
    Set-Content -Path $ResultFile -Value $text -Encoding ASCII
}

Write-Log "=== Snippet verify ($Track ~126s) ==="

if (-not (Test-AdbDeviceOnline $EmuSerial)) {
    Start-EmulatorIfNeeded
}
if (-not (Test-AdbDeviceOnline $EmuSerial)) {
    Set-SnippetResult 'FAIL' 'SKIP' 'SKIP' "emulator $EmuSerial not online"
    exit 1
}

$devices = (& adb devices 2>$null) -join "`n"
if ($devices -match "${ForbiddenSerial}\s+device") {
    Write-Log "WARNING: phone $ForbiddenSerial connected — install ONLY to $EmuSerial"
}

if (Test-Path $EmulatorLockFile) {
    Write-Log "Waiting for E2E lock ..."
    $lockDeadline = (Get-Date).AddSeconds(900)
    while ((Test-Path $EmulatorLockFile) -and (Get-Date) -lt $lockDeadline) {
        Start-Sleep -Seconds 30
    }
}

try {
    Set-Content -Path $EmulatorLockFile -Value "$PID $(Get-Date -Format o)" -Encoding ASCII

    Build-ApkIfStale
    $apkPath = Join-Path $Root $ApkRel
    if (-not (Test-Path $apkPath)) { throw "APK not found: $apkPath" }

    Write-Log "Installing to $EmuSerial ONLY ..."
    Invoke-Adb -Command @('install', '-r', $apkPath) | Out-Null
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    Invoke-Adb -Command @('shell', 'am', 'force-stop', $Package) | Out-Null
    Start-Sleep -Seconds 2
    Invoke-Adb -Command @('shell', 'monkey', '-p', $Package, '-c', 'android.intent.category.LAUNCHER', '1') | Out-Null
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $null = Wait-AppReady

    if (-not (Invoke-BootstrapE2e 'skip-onboarding' 'SandboxE2E.*AREA=onboarding RESULT=PASS' 45)) {
        Set-SnippetResult 'FAIL' 'SKIP' 'SKIP' 'bootstrap skip-onboarding failed'
        exit 1
    }
    $null = Invoke-BootstrapE2e 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 60
    $null = Invoke-BootstrapE2e 'probe-handlers' 'SandboxE2E.*AREA=handlers-probe RESULT=PASS' 90
    if (-not (Invoke-BootstrapE2e 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45)) {
        Set-SnippetResult 'FAIL' 'SKIP' 'SKIP' 'bootstrap clear-server failed'
        exit 1
    }
    if (-not (Invoke-BootstrapE2e 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180)) {
        Set-SnippetResult 'FAIL' 'SKIP' 'SKIP' 'bootstrap check-ytdlp failed'
        exit 1
    }

    Write-Log "Playing $Track ..."
    Invoke-Adb -Command @('logcat', '-c') | Out-Null
    $encArtist = [uri]::EscapeDataString($Artist)
    $encAlbum = [uri]::EscapeDataString($Album)
    $encTrack = [uri]::EscapeDataString($Track)
    $playPath = "play-album-track?artist=$encArtist" + '&album=' + $encAlbum + '&track=' + $encTrack + '&playTimeoutMs=420000'
    $playOk, $playLine = Invoke-E2e $playPath 'SandboxE2E.*AREA=album-track-play RESULT=PASS' $PlayTimeoutSec
    if (-not $playOk) {
        $failLine = (Get-LogcatChunk -Tail 4000 | Select-String 'SandboxE2E.*AREA=album-track-play RESULT=FAIL' | Select-Object -Last 1)
        $failDetail = if ($failLine) { $failLine.Line } else { 'album-track-play logcat timeout' }
        Set-SnippetResult 'FAIL' 'FAIL' 'SKIP' $failDetail
        exit 1
    }
    Write-Log "album-track-play: PASS"

    Write-Log 'Polling snippet gate (file:// or dur>=90, up to 240s) ...'
    $pollDeadline = (Get-Date).AddSeconds(240)
    $snippetPass = $false
    $detail = 'snippet poll timeout'
    $stableSince = $null
    $lastDur = 0.0
    while ((Get-Date) -lt $pollDeadline) {
        $null = Invoke-E2e 'probe-exo' 'SandboxE2E.*AREA=exo-probe RESULT=PASS' 20
        $probeLine = (Get-LogcatChunk -Tail 4000 | Select-String 'SandboxE2E.*AREA=exo-probe RESULT=PASS' | Select-Object -Last 1)
        if ($probeLine) {
            $line = $probeLine.Line
            $isFile = $line -match 'file=true'
            $dur = 0.0
            if ($line -match 'dur=([\d.]+)') { $dur = [double]$Matches[1] }
            $isProxy = $line -match 'proxy=true'
            if ($isFile) {
                $snippetPass = $true
                $detail = "mode=file dur=$dur"
                break
            }
            if ($dur -ge 90 -and -not $isProxy) {
                if ($lastDur -gt 0 -and [math]::Abs($dur - $lastDur) -lt 1) {
                    if (-not $stableSince) { $stableSince = Get-Date }
                    if (((Get-Date) - $stableSince).TotalSeconds -ge 30) {
                        $snippetPass = $true
                        $detail = "mode=duration dur=$dur"
                        break
                    }
                } else {
                    $stableSince = $null
                }
                $lastDur = $dur
            } else {
                $stableSince = $null
                $lastDur = $dur
            }
        }
        Start-Sleep -Seconds 5
    }

    if ($snippetPass) {
        Write-Log "snippet-gate: PASS $detail"
        Set-SnippetResult 'PASS' 'PASS' 'PASS' $detail
        exit 0
    }

    Write-Log "snippet-gate: FAIL $detail"
    Set-SnippetResult 'FAIL' 'PASS' 'FAIL' $detail
    exit 1
} finally {
    Remove-Item $EmulatorLockFile -Force -ErrorAction SilentlyContinue
}
