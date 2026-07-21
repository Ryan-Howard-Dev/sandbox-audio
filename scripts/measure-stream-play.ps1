param(
  # Rotate default query — avoid canonical Blinding Lights stress magnet.
  [string]$Query = "radiohead creep"
)
$adb = "C:\Users\RH\AppData\Local\Android\Sdk\platform-tools\adb.exe"
$dev = "46349770"
$pkg = "rd.sheepskin.sandboxmusic"

& $adb -s $dev shell am force-stop $pkg | Out-Null
& $adb -s $dev logcat -c | Out-Null
& $adb -s $dev shell am start -n "$pkg/.MainActivity" | Out-Null
Start-Sleep -Seconds 13
$enc = [uri]::EscapeDataString($Query)
& $adb -s $dev shell am start -a android.intent.action.VIEW -d "sandboxmusic://e2e/search-play?query=$enc" $pkg | Out-Null
Start-Sleep -Seconds 45
& $adb -s $dev logcat -d | Select-String -Pattern "handlePlayEnvelope|nativeExoPlayUrl|YtDlpMobile|SandboxE2E|ExoPlayback|search-play|FATAL"
