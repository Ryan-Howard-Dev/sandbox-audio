# Vinyl ↔ album artwork switch stability (Android emulator ONLY)
# Usage: .\scripts\android-switch-stability-e2e.ps1
#        .\scripts\android-switch-stability-e2e.ps1 -WaitForLock
# NEVER installs to physical devices — emulator-5554 only.

param(
    [switch]$WaitForLock
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

& "$PSScriptRoot\android-album-stability-e2e.ps1" -SwitchStabilityOnly
