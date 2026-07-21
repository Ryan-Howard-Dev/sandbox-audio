param(
  [string[]]$Queries = @(
    "kanye west king",
    "esdee kid esdee",
    "radiohead creep",
    "daft punk harder",
    "jay z empire state of mind",
    "drake gods plan",
    "taylor swift anti hero"
  ),
  [int]$WaitPerTrackSec = 40,
  [string]$Device = "46349770"
)
$adb = "C:\Users\RH\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$pkg = "rd.sheepskin.sandboxmusic"
$results = @()

& $adb -s $Device shell am force-stop $pkg | Out-Null
& $adb -s $Device logcat -c | Out-Null
& $adb -s $Device shell am start -n "$pkg/.MainActivity" | Out-Null
Start-Sleep -Seconds 12

foreach ($q in $Queries) {
  Write-Host "=== PLAY: $q ==="
  $enc = [uri]::EscapeDataString($q)
  & $adb -s $Device shell am start -a android.intent.action.VIEW -d "sandboxmusic://e2e/search-play?query=$enc" $pkg | Out-Null
  Start-Sleep -Seconds $WaitPerTrackSec
  $fatal = & $adb -s $Device logcat -d | Select-String -Pattern "FATAL EXCEPTION|ForegroundServiceDidNotStartInTime|AndroidRuntime.*$pkg"
  $play = & $adb -s $Device logcat -d | Select-String -Pattern "nativeExoPlayUrl|SandboxE2E|handlePlayEnvelope|YtDlpMobile.*hit|ExoPlayback.*playing" | Select-Object -Last 8
  $crashed = ($fatal | Measure-Object).Count -gt 0
  $results += [pscustomobject]@{ Query = $q; Crashed = $crashed; Fatal = ($fatal | Select-Object -Last 3 | Out-String).Trim(); PlayLog = ($play | Out-String).Trim() }
  if ($crashed) {
    Write-Host "CRASH detected for: $q"
    break
  }
  & $adb -s $Device logcat -c | Out-Null
}

$results | Format-Table -AutoSize Query, Crashed
Write-Host "`n--- Summary ---"
$results | ForEach-Object { Write-Host "$($_.Query): crashed=$($_.Crashed)" }
