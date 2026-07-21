$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\RH\Downloads\sovereign-music-console'
Set-Location $Root
. "$Root\scripts\set-android-env.ps1"
$EmuSerial = 'emulator-5554'
$Package = 'rd.sheepskin.sandboxmusic'
$Activity = "$Package/.MainActivity"
$Artist = 'Kanye West'
$ProgressSecs = 60
$IntegritySecs = 90
function Invoke-Adb { param([string[]]$Command); Assert-NotUserDeviceDestructiveAdb -Serial $EmuSerial -Command $Command; & adb.exe -s $EmuSerial @Command; if ($LASTEXITCODE -ne 0) { throw ("adb failed: " + ($Command -join ' ')) } }
function Invoke-DeepLink { param([string]$Path); $uri = "sandboxmusic://e2e/$Path"; & adb.exe -s $EmuSerial shell am start -a android.intent.action.VIEW -d $uri -n $Activity | Out-Null }
function Get-LogcatChunk { param([int]$Tail=20000); $raw = & adb.exe -s $EmuSerial logcat -d -t $Tail 2>$null; if ($raw -is [array]) { return ($raw -join "`n") }; return [string]$raw }
function Wait-LogcatMatch { param([string]$Pattern,[int]$TimeoutSec=90); $deadline=(Get-Date).AddSeconds($TimeoutSec); while((Get-Date) -lt $deadline){ $m=[regex]::Match((Get-LogcatChunk),$Pattern); if($m.Success){return $true,$m.Value}; Start-Sleep 2 }; return $false,'' }
function Invoke-E2e { param([string]$Path,[string]$WaitPattern,[int]$TimeoutSec=120); Invoke-DeepLink $Path; Start-Sleep 2; if(-not $WaitPattern){return $true,''}; Wait-LogcatMatch $WaitPattern $TimeoutSec }
function Get-LogcatLines { param([string]$Pattern); [regex]::Matches((Get-LogcatChunk),$Pattern) | ForEach-Object { $_.Value } }
function Get-RegexGroup { param([string]$Text,[string]$Pattern,[int]$Group=1); if(-not $Text){return ''}; $m=[regex]::Match($Text,$Pattern); if($m.Success){return $m.Groups[$Group].Value}; return '' }
function Test-Track { param([string]$Kind,[string]$Album,[string]$Track)
  $result=[ordered]@{Track=$Track;Album=$Album;Play='FAIL';Progress='FAIL';Integrity='FAIL';Duration='';Notes=''}
  Invoke-Adb @('logcat','-c') | Out-Null
  Invoke-E2e 'navigate?tab=home' 'SandboxE2E.*AREA=navigation RESULT=PASS tab=home' 30 | Out-Null
  Start-Sleep 1
  $encArtist=[uri]::EscapeDataString($Artist); $encTrack=[uri]::EscapeDataString($Track)
  if($Kind -eq 'album'){ $encAlbum=[uri]::EscapeDataString($Album); $playPath="play-album-track?artist=$encArtist&album=$encAlbum&track=$encTrack"; $playPattern='SandboxE2E.*AREA=album-track-play RESULT=PASS'; $playTimeout=420 } else { $playPath="play-artist-track?artist=$encArtist&track=$encTrack"; $playPattern='SandboxE2E.*AREA=artist-track-play RESULT=PASS'; $playTimeout=240 }
  $playOk = (Invoke-E2e $playPath $playPattern $playTimeout)[0]
  $durLine = (Get-LogcatLines 'SandboxE2E.*AREA=(album-track-play|artist-track-play).*dur=') | Select-Object -Last 1
  $result.Duration = Get-RegexGroup $durLine 'dur=([\d.]+)'
  if(-not $playOk){ $fail=(Get-LogcatLines 'SandboxE2E.*AREA=(album-track-play|artist-track-play) RESULT=FAIL.*') | Select-Object -Last 1; $result.Notes="play-fail $fail"; return $result }
  $result.Play='PASS'
  Invoke-Adb @('logcat','-c') | Out-Null
  if(-not (Invoke-E2e "wait-progress?seconds=$ProgressSecs" 'SandboxE2E.*AREA=playback-progress RESULT=PASS' ($ProgressSecs+90))[0]){ $result.Notes += ' progress-fail' } else { $result.Progress='PASS' }
  Invoke-Adb @('logcat','-c') | Out-Null
  $encTitle=[uri]::EscapeDataString($Track)
  if((Invoke-E2e "stream-integrity?seconds=$IntegritySecs&title=$encTitle" 'SandboxE2E.*AREA=stream-integrity RESULT=PASS' ($IntegritySecs+30))[0]){ $result.Integrity='PASS' } else { $reason=(Get-LogcatLines 'SandboxE2E.*AREA=stream-integrity RESULT=FAIL.*') | Select-Object -Last 1; $result.Notes += " integrity-fail $reason" }
  Invoke-E2e 'stop-exo' 'SandboxE2E.*AREA=exo-stop RESULT=PASS' 20 | Out-Null
  Start-Sleep 2
  return $result
}
function Boot { param($Path,$Pat,$T=120,$R=3); for($i=0;$i -lt $R;$i++){ if((Invoke-E2e $Path $Pat $T)[0]){return $true}; Start-Sleep 5 }; return $false }
Invoke-Adb @('logcat','-c') | Out-Null
Invoke-Adb @('shell','am','force-stop',$Package) | Out-Null
Start-Sleep 2
Invoke-Adb @('shell','am','start','-W','-a','android.intent.action.VIEW','-d','sandboxmusic://e2e/skip-onboarding','-n',$Activity) | Out-Null
Write-Host 'Waiting 40s for React + E2E handlers...'
Start-Sleep 40
if(-not (Boot 'probe-bridge' 'SandboxE2E.*AREA=bridge-probe RESULT=PASS' 30)){ throw 'bridge-probe failed' }
$null = Boot 'clear-server' 'SandboxE2E.*AREA=server-url RESULT=PASS' 45
if(-not (Boot 'check-ytdlp' 'SandboxE2E.*AREA=ytdlp-mobile RESULT=PASS' 180)){ throw 'ytdlp failed' }
$null = Boot 'search?query=Kanye%20West' 'SandboxE2E.*AREA=search RESULT=PASS' 120
Start-Sleep 3
$king = Test-Track -Kind album -Album Bully -Track KING
$follow = Test-Track -Kind album -Album 'Jesus Is King' -Track 'Follow God'
Write-Host '=== RESULTS ==='
$king | Format-List
$follow | Format-List
$kingDurOk = ([double]$king.Duration -ge 110 -and [double]$king.Duration -le 140)
$followDurOk = ([double]$follow.Duration -ge 100)
Write-Host "KING duration ~126 verified: $(if($kingDurOk){'YES'}else{'NO'}) (dur=$($king.Duration))"
Write-Host "KING stable 90s: $(if($king.Integrity -eq 'PASS'){'YES'}else{'NO'})"
Write-Host "Follow God not snippet: $(if($followDurOk -and $follow.Integrity -eq 'PASS'){'YES'}else{'NO'}) (dur=$($follow.Duration))"
$chunk = Get-LogcatChunk
[regex]::Matches($chunk,'(?m).*(nativeExoStreamResolver|PREVIEW URL|piped fallback|pickMobileExo|local file for long track).*') | Select-Object -Last 15 | ForEach-Object { $_.Value }
