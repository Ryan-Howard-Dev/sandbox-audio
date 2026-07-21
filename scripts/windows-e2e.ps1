# Sandbox Music - Windows Tauri desktop smoke E2E
# Usage: .\scripts\windows-e2e.ps1

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$ExeRel = 'src-tauri\target\release\Sandbox Music.exe'
$ExePath = Join-Path $Root $ExeRel
$ServerLogFile = Join-Path $Root '.e2e-windows-server.log'
$AppLogFile = Join-Path $Root '.e2e-windows-app.log'
$ServerJob = $null
$AppProc = $null

function Write-AreaResult {
    param([string]$Area, [bool]$Pass, [string]$Detail = '')
    $status = if ($Pass) { 'PASS' } else { 'FAIL' }
    $line = "[$status] $Area"
    if ($Detail) { $line += " - $Detail" }
    if ($Pass) { Write-Host $line -ForegroundColor Green } else { Write-Host $line -ForegroundColor Red }
    return $Pass
}

function Start-Tier34Server {
    Write-Host 'Ensuring tier34 server on port 3001 ...'
    try { npx --yes kill-port 3001 2>$null | Out-Null } catch { }
    $job = Start-Job -ScriptBlock {
        param($Root, $LogFile)
        Set-Location $Root
        $env:PORT = '3001'
        npx tsx tier34-server/index.ts *> $LogFile
    } -ArgumentList $Root, $ServerLogFile
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 3
            if ($resp.StatusCode -eq 200) { return $job }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw 'Tier34 server failed to start on port 3001'
}

function Ensure-DesktopBuild {
    if (Test-Path $ExePath) {
        Write-Host "Desktop binary present: $ExePath"
        return
    }
    Write-Host 'Building Tauri desktop (release) ...'
    npm run build:desktop
    if (-not (Test-Path $ExePath)) { throw "Missing desktop binary at $ExePath" }
}

$results = @{}
try {
    Ensure-DesktopBuild
    $results['Desktop binary'] = Write-AreaResult 'Desktop binary' $true $ExePath

    $ServerJob = Start-Tier34Server
    $hostHealthOk = $false
    try {
        $health = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/health' -UseBasicParsing -TimeoutSec 5
        $hostHealthOk = ($health.StatusCode -eq 200)
    } catch { }
    $results['Tier34 health'] = Write-AreaResult 'Tier34 health' $hostHealthOk 'http://127.0.0.1:3001/health'

    Write-Host "Launching $ExePath ..."
    $AppProc = Start-Process -FilePath $ExePath -PassThru -WindowStyle Minimized
    Start-Sleep -Seconds 8
    $procOk = -not $AppProc.HasExited
    $results['App process'] = Write-AreaResult 'App process' $procOk "pid=$($AppProc.Id)"

    $feedOk = $false
    try {
        $feed = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/feed' -UseBasicParsing -TimeoutSec 10
        $feedOk = ($feed.StatusCode -eq 200)
    } catch { }
    $results['Tier34 feed API'] = Write-AreaResult 'Tier34 feed API' $feedOk 'GET /api/feed'

    Write-Host ''
    Write-Host '=== WINDOWS E2E SUMMARY ===' -ForegroundColor Cyan
    $allPass = $true
    foreach ($kv in $results.GetEnumerator() | Sort-Object Name) {
        $mark = if ($kv.Value) { 'PASS' } else { 'FAIL' }
        Write-Host "$mark  $($kv.Key)"
        if (-not $kv.Value) { $allPass = $false }
    }
    if (-not $allPass) { exit 1 }
    Write-Host ''
    Write-Host "All areas PASS. Binary: $ExePath" -ForegroundColor Green
    exit 0
}
finally {
    if ($AppProc -and -not $AppProc.HasExited) {
        Stop-Process -Id $AppProc.Id -Force -ErrorAction SilentlyContinue
    }
    if ($ServerJob) {
        Stop-Job $ServerJob -ErrorAction SilentlyContinue
        Remove-Job $ServerJob -Force -ErrorAction SilentlyContinue
    }
}
