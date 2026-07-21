param(
  [string]$Name = "Drake"
)
$adb = "C:\Users\RH\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$dev = "46349770"
$pkg = "rd.sheepskin.sandboxmusic"

& $adb -s $dev shell am force-stop $pkg | Out-Null
& $adb -s $dev logcat -c | Out-Null
& $adb -s $dev shell am start -n "$pkg/.MainActivity" | Out-Null
Start-Sleep -Seconds 12
$enc = [uri]::EscapeDataString($Name)
& $adb -s $dev shell am start -a android.intent.action.VIEW -d "sandboxmusic://e2e/open-search-artist?name=$enc" $pkg | Out-Null
Start-Sleep -Seconds 22
& $adb -s $dev logcat -d | Select-String -Pattern "artist-select|artist-mount|artist-disco|search-nav|FATAL|ANR "
