# Source before Android builds (PowerShell):
#   . .\scripts\set-android-env.ps1
#
# Or run once per session:
#   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
#   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
#   $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

$jbr = "${env:ProgramFiles}\Android\Android Studio\jbr"
if (-not (Test-Path "$jbr\bin\java.exe")) {
    $jbr = "${env:LOCALAPPDATA}\Programs\Android Studio\jbr"
}

if (Test-Path "$jbr\bin\java.exe") {
    $env:JAVA_HOME = $jbr
} else {
    Write-Warning "Android Studio JBR not found. Set JAVA_HOME to a JDK 17+ install."
}

$sdk = "$env:LOCALAPPDATA\Android\Sdk"
if (Test-Path $sdk) {
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
} else {
    Write-Warning "Android SDK not found at $sdk. Install via Android Studio SDK Manager."
}

if ($env:JAVA_HOME) {
    $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
}
if ($env:ANDROID_HOME) {
    $env:PATH = "$env:ANDROID_HOME\platform-tools;$env:ANDROID_HOME\emulator;$env:PATH"
}

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"

. "$PSScriptRoot\_adb-user-device-guard.ps1"
