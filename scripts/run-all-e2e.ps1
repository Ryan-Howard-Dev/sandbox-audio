# Sandbox Music — cross-platform E2E orchestrator
# Usage: .\scripts\run-all-e2e.ps1 [-SkipAndroid] [-SkipAndroidTv] [-SkipWindows] [-SkipLinux]

param(
    [switch]$SkipAndroid,
    [switch]$SkipAndroidTv,
    [switch]$SkipWindows,
    [switch]$SkipLinux
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$results = [ordered]@{}

function Run-Platform {
    param(
        [string]$Name,
        [scriptblock]$Block
    )
    Write-Host ''
    Write-Host "========== $Name ==========" -ForegroundColor Cyan
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        & $Block
        $exit = $LASTEXITCODE
        if ($null -eq $exit) { $exit = 0 }
    } catch {
        Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $exit = 1
    }
    $sw.Stop()
    $status = switch ($exit) {
        0 { 'PASS' }
        2 { 'SKIP' }
        default { 'FAIL' }
    }
    $results[$Name] = [pscustomobject]@{
        Status = $status
        Exit   = $exit
        Time   = $sw.Elapsed.ToString('mm\:ss')
        Note   = ''
    }
}

# iOS — documented blocker (macOS + Xcode only)
$results['iOS (macOS/Xcode)'] = [pscustomobject]@{
    Status = 'SKIP'
    Exit   = 2
    Time   = 'n/a'
    Note   = 'Requires macOS with Xcode; not feasible on Windows'
}

if (-not $SkipWindows) {
    Run-Platform 'Windows (Tauri)' {
        & "$PSScriptRoot\windows-e2e.ps1"
    }
} else {
    $results['Windows (Tauri)'] = [pscustomobject]@{ Status = 'SKIP'; Exit = 2; Time = 'n/a'; Note = '-SkipWindows' }
}

if (-not $SkipAndroid) {
    Run-Platform 'Android phone (emulator)' {
        & "$PSScriptRoot\android-emulator-e2e.ps1"
    }
} else {
    $results['Android phone (emulator)'] = [pscustomobject]@{ Status = 'SKIP'; Exit = 2; Time = 'n/a'; Note = '-SkipAndroid' }
}

if (-not $SkipAndroidTv) {
    Run-Platform 'Android TV (emulator)' {
        & "$PSScriptRoot\android-tv-e2e.ps1"
    }
} else {
    $results['Android TV (emulator)'] = [pscustomobject]@{ Status = 'SKIP'; Exit = 2; Time = 'n/a'; Note = '-SkipAndroidTv' }
}

if (-not $SkipLinux) {
    Run-Platform 'Linux (WSL Tauri)' {
        $wsl = Get-Command wsl -ErrorAction SilentlyContinue
        if (-not $wsl) {
            Write-Host 'WSL not available — skipping Linux E2E' -ForegroundColor Yellow
            exit 2
        }
        $distro = wsl -l -q 2>$null | Where-Object { $_.Trim() -ne '' } | Select-Object -First 1
        if (-not $distro) {
            Write-Host 'No WSL distro installed — skipping Linux E2E' -ForegroundColor Yellow
            exit 2
        }
        $linuxPath = (wsl wslpath -a $Root).Trim()
        wsl bash -lc "cd '$linuxPath' && chmod +x scripts/linux-e2e.sh && ./scripts/linux-e2e.sh"
    }
} else {
    $results['Linux (WSL Tauri)'] = [pscustomobject]@{ Status = 'SKIP'; Exit = 2; Time = 'n/a'; Note = '-SkipLinux' }
}

Write-Host ''
Write-Host '=== CROSS-PLATFORM E2E SUMMARY ===' -ForegroundColor Cyan
Write-Host ('{0,-28} {1,-6} {2,-8} {3}' -f 'Platform', 'Status', 'Time', 'Note')
Write-Host ('{0,-28} {1,-6} {2,-8} {3}' -f ('-' * 28), ('-' * 6), ('-' * 8), ('-' * 20))

$failCount = 0
$passCount = 0
foreach ($entry in $results.GetEnumerator()) {
    $row = $entry.Value
    $note = if ($null -ne $row.PSObject.Properties['Note']) { [string]$row.Note } else { '' }
    $color = switch ($row.Status) {
        'PASS' { $passCount++; 'Green' }
        'FAIL' { $failCount++; 'Red' }
        default { 'Yellow' }
    }
    Write-Host ('{0,-28} {1,-6} {2,-8} {3}' -f $entry.Key, $row.Status, $row.Time, $note) -ForegroundColor $color
}

Write-Host ''
if ($failCount -gt 0) {
    Write-Host "$failCount platform(s) FAILED. Re-run individual scripts under scripts/" -ForegroundColor Red
    exit 1
}
Write-Host "All feasible platforms PASS ($passCount passed)." -ForegroundColor Green
exit 0
