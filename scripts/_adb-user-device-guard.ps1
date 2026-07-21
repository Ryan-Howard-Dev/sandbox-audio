# Blocks adb uninstall / pm clear on the user's physical device (app downloads live in app data).
# Dot-sourced from set-android-env.ps1 — see scripts/INSTALL-RULES.md

if (-not $script:SandboxUserDeviceSerial) {
    $script:SandboxUserDeviceSerial = if ($env:SANDBOX_USER_DEVICE) {
        $env:SANDBOX_USER_DEVICE.Trim()
    } else {
        '46349770'
    }
}

function Test-IsDestructiveAdbCommand {
    param([Parameter(Mandatory)][string[]]$Command)
    if (-not $Command -or $Command.Count -eq 0) { return $false }
    if ($Command[0] -eq 'uninstall') { return $true }
    if ($Command[0] -eq 'shell' -and $Command.Count -ge 2) {
        $shellRest = ($Command[1..($Command.Count - 1)] -join ' ')
        if ($shellRest -match '(?i)^pm\s+(clear|uninstall)\b') { return $true }
    }
    return $false
}

function Get-AdbTargetSerial {
    param([string]$Serial)
    if ($Serial) { return $Serial }
    $default = (& adb.exe get-serialno 2>$null | Out-String).Trim()
    if ($default -and $default -ne 'unknown') { return $default }
    return ''
}

function Assert-NotUserDeviceDestructiveAdb {
    param(
        [string]$Serial,
        [Parameter(Mandatory)][string[]]$Command
    )
    if (-not (Test-IsDestructiveAdbCommand $Command)) { return }
    $target = Get-AdbTargetSerial $Serial
    if ($target -eq $script:SandboxUserDeviceSerial) {
        throw 'USER DEVICE — downloads will be lost. Use install -r only.'
    }
}
