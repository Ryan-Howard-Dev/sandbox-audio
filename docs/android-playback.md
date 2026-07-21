# Android background playback

Sovereign Music Console uses **Media3 ExoPlayer outside the Capacitor WebView** as the default Android decode path. Native polish is provided by the in-app **`BackgroundMedia`** Capacitor plugin (see `src/backgroundMedia.ts` and `android/.../MediaPlaybackForegroundService.java`).

## What works today

| Feature | Implementation |
| --- | --- |
| Default decode | **ExoPlayer** via `NativeExoPlayback` plugin + `src/androidNativePlayback.ts` |
| Background playback | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` + partial `WAKE_LOCK` keeps the process alive while ExoPlayer decodes |
| Notification controls | Native `MediaSessionCompat` + `MediaStyle` notification (play/pause, prev/next) |
| Lock screen | MediaSession metadata (title, artist, album, artwork, progress) |
| Notification progress | Progress bar on expanded notification when duration is known |
| Mini player modes | Settings → Playback → Off, Picture in picture, System top bar |
| Picture in picture | Android 8+ floating window with album art and transport controls (API 26+) |
| System top bar | Higher-priority MediaStyle notification + MediaSession for OEM now-playing chips |
| Headphone / BT controls | MediaSession transport callbacks forwarded to the active decode engine |
| Audio focus | Native `AudioManager` — pauses on call/notification/other media loss; resumes after transient loss (calls) |
| Phone speaker / routing | `MODE_NORMAL` + `STREAM_MUSIC` volume keys; OS routes to speaker, BT, or wired automatically |
| Headphone unplug | `ACTION_AUDIO_BECOMING_NOISY` pauses playback (standard music-app behavior) |
| Audio output (Settings) | Read-only route hint: Speaker / Bluetooth / Wired |
| Battery optimization | One-time `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` prompt when playback starts |
| Offline locker | IndexedDB blobs registered to native cache → `content://` via `LockerBlobContentProvider` |

## ExoPlayer vs WebView

**Default path (production):** ExoPlayer native decode + native MediaSession bridge.

- Pros: Stable background playback on aggressive OEM ROMs; gapless album queue via MediaItem preload; native crossfade (~2.5s volume ramp on manual skip, ~600ms on gapless auto-advance); EBU R128 ReplayGain proxy via per-track volume; offline locker without tier34 HTTP.
- Cons: Crossfade is volume-ramp based (not sample-accurate Web Audio overlap). True bit-perfect USB requires Android 14+ HAL support (experimental setting).

**Legacy WebView path:** Settings → Playback → **Legacy WebView playback** routes decode back to `HTMLAudioElement` inside the WebView with the crossfade router (`src/playbackCrossfade.ts`).

- Pros: Web Audio crossfade overlap when native ramps are insufficient.
- Cons: WebView audio can stall if the renderer is throttled despite the foreground service; disables ExoPlayer while enabled.

Settings → Playback → **Crossfade** enables native ExoPlayer crossfade when ExoPlayer is active (default). It does **not** require the legacy WebView toggle.

Settings → Playback → **Native playback (ExoPlayer)** remains available (default **ON**). Turn it off only when you need to force WebView decode without crossfade.

### Architecture

```
IndexedDB locker blob
        │
        ▼
src/nativeExoLockerBridge.ts  ──register──►  LockerBlobRegistry (app cache)
        │                                              │
        ▼                                              ▼
content://{appId}.locker/{id}  ◄──PFD──  LockerBlobContentProvider
        │
        ▼
NativeExoPlaybackPlugin (ExoPlayer MediaItem.fromUri)
        │
        ▼
sandboxLayer1.ts useAudioFSM (native Exo path)
```

HTTP(S) streams (remote URLs, tier34 `/api/cast/stream/…`) still play directly when no local blob is available.

### Gapless: what is / isn't possible

| Symfonium-class goal | ExoPlayer path (default) | WebView opt-in |
| --- | --- | --- |
| No silence between consecutive queue tracks | **Yes** (gapless pref ON) | **Yes** (HTMLAudio prebuffer) |
| Preload next track buffer before current ends | **Yes** — `enqueueNext` + 50s max buffer | **Yes** — hidden `HTMLAudioElement` |
| Locker offline (no tier34) | **Yes** — `content://` bridge | **Yes** — `blob:` URLs |
| tier34 `/api/locker/blob/{hash}` | **Yes** — HTTP fallback | **Yes** |
| Sample-accurate crossfade | **Partial** — native volume ramp (~2.5s manual / ~600ms gapless) | **Partial** — 2.5s Web Audio fade |
| ReplayGain loudness match (EBU) | **Yes** — EBU -14 LUFS proxy + tag gain via per-track `setVolume` | **Yes** — Web Audio router |

Gapless on Exo activates when **Settings → Gapless playback** is on (default **on**). No separate experimental gate.

### Desktop (Tauri / browser) gapless

Default decode on Windows/macOS/Linux remains the WebView-style stack: `useAudioFSM` in `src/sandboxLayer1.ts` + `PlaybackCrossfadeRouter` in `src/playbackCrossfade.ts`.

**Audiophile native path (Tauri only):** Settings → Playback → Audiophile mode routes HTTP streams through the native PCM plugin (`src/nativeAudiophile.ts`). Not available on Android.

## Phase 2 (optional)

**Step 1 (today):** ExoPlayer default decode with native crossfade + gapless coexistence. Legacy WebView path remains an escape hatch.

### Phase 2b — ExoPlayer audio offload

- Hardware audio offload for lower CPU use during background playback.
- Enable only after a runtime probe confirms device/OEM support.
- Default **off**; falls back to standard ExoPlayer decode when unsupported.

### Phase 2a — Bit-perfect USB (Android 14+)

- `MIXER_BEHAVIOR_BIT_PERFECT` for **wired USB DAC** output only (HAL-gated).
- When active: no app-side ReplayGain volume scaling; OS/mixer owns level.
- Probe via `AudioManager.getSupportedMixerAttributes()` — Settings → **USB bit-perfect DAC (experimental)**.
- Implemented in `ExoUsbBitPerfectHelper.java` + `NativeExoPlayback.setBitPerfectEnabled`.

**Out of scope on Android:** libusb direct DAC control, HDMI bitstream passthrough. Desktop audiophile mode stays **Tauri-only**.

## Build & device test

```bash
npm run build:android:apk
```

Or step by step:

```bash
npm run build:android          # vite build → cap sync → splash cleanup
cd android && ./gradlew assembleDebug
```

### Install on device (important)

Android **keeps WebView and PWA caches** across overlay installs. If the UI looks unchanged after rebuilding, the APK often still contains new assets but the old WebView cache is being served.

**Recommended — clean install:**

```bash
adb uninstall rd.sheepskin.sandboxmusic
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Or on the phone: **Settings → Apps → Sandbox Music → Uninstall**, then sideload the new APK.

Avoid `adb install -r` when verifying UI/CSS changes unless you also clear app storage (**Settings → Apps → Sandbox Music → Storage → Clear data**).

`MainActivity` clears WebView cache automatically when the APK `lastUpdateTime` changes (fresh install or uninstall-then-install). Service workers are disabled on Capacitor native in `src/platformEnv.ts`.

APK path: `android/app/build/outputs/apk/debug/app-debug.apk`

1. Open the app, start playback, press Home — audio should continue and a notification should appear.
2. Use notification and lock-screen controls (play/pause, skip).
3. Connect wired/BT headphones and use media buttons.
4. Start a phone call or another music app — Sovereign should pause (audio focus). End the call — playback should resume.
5. With wired headphones, unplug them — playback should pause (`ACTION_AUDIO_BECOMING_NOISY`).
6. Hardware volume keys should adjust **media** volume (not ringtone) while the app is open.
7. **Settings → Playback → Audio output** shows Speaker / Bluetooth / Wired based on OS routing.
8. Accept the battery optimization exemption dialog if shown; verify in **Settings → Apps → Sovereign → Battery**.
9. **Settings → Playback → Mini player when background** — try each mode:
   - **Off**: background audio + lock screen / notification only.
   - **Picture in picture**: press Home while playing — floating album-art window with prev/play/next.
   - **System top bar**: pull down notification shade — expanded media notification; OEM mini capsules (Realme, OnePlus) may appear when supported.
10. **Settings → Playback** — confirm **Native playback (ExoPlayer)** is ON by default. Play a locker track **offline** (airplane mode, no Sandbox Server URL) — ExoPlayer should decode via `content://`.
11. Enable **Crossfade** — manually skip mid-track on ExoPlayer; hear native volume ramp (Exo stays active). Legacy **WebView playback** is only needed if you want Web Audio overlap instead.

### OnePlus 12 — install and verify playback

Device: **OnePlus 12** (OxygenOS 14+, Fluid Cloud now-playing when supported).

**1. Build and clean-install**

```bash
npm run build:android:apk
adb uninstall rd.sheepskin.sandboxmusic
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

**2. First launch — onboarding**

- Complete welcome → profile → taste steps.
- **Server step:** choose **Server on another device**, enter your PC URL (e.g. `http://192.168.1.10:3001`), tap **Test connection** — must show "Connected".
- **Audio test step:** tap **Play test tone** — you should hear a brief tone (confirms ExoPlayer + content:// bridge).
- Finish onboarding.

**3. Locker playback (offline — no tier34 required)**

- Import or upload at least one track to **Locker** (or use an existing import).
- Enable **airplane mode** (or leave server URL blank).
- Open Locker → tap play on a track.
- Audio should start via ExoPlayer + `content://` (not WebView blob).
- Pull notification shade — Fluid Cloud / media controls should appear.

**4. Catalog playback (tier34 required)**

- Disable airplane mode; PC and phone on same Wi‑Fi.
- On PC: open Sovereign desktop app (tier34 auto-starts on port 3001) or run `npm run dev:tier34`.
- On phone: **Settings → Addons → Sandbox Server URL** — confirm PC address, save.
- Search or browse catalog → tap play — full track via tier34 HTTP stream.

**5. Troubleshooting**

| Symptom | Fix |
| --- | --- |
| No sound on locker track | Settings → Playback → **Native playback (ExoPlayer)** ON; **Legacy WebView** OFF. Retry audio test in onboarding. |
| Catalog says "Sandbox Server required" | Set PC URL in Settings → Addons; tap Test connection in onboarding. |
| "Starting Sandbox Server…" toast on phone | Expected only on desktop — mobile cannot start tier34; configure remote URL instead. |
| Stale UI after APK update | Uninstall + reinstall (WebView cache). |

**6. Gapless album test**

- Settings → **Gapless** ON, **ExoPlayer** ON.
- Play 3+ consecutive locker tracks offline.
- `adb logcat -s NativeExoPlayback` — queue length should increase before each boundary.

### OnePlus 12 gapless test path (legacy checklist)

Device: **OnePlus 12** (OxygenOS / ColorOS-derived ROM, Fluid Cloud now-playing when supported).

1. Clean-install APK (see above). **Settings → Playback** → confirm **Gapless playback** and **Native playback (ExoPlayer)** are ON.
2. **Airplane mode ON** (or no Sandbox Server URL). Locker → play an album with 3+ consecutive offline tracks.
3. Listen at track boundaries — transition should be continuous when the next track was prefetched via `enqueueNext`.
4. Pull notification shade — Fluid Cloud / now-playing chip should update per track.
5. `adb logcat -s NativeExoPlayback` — confirm queue length increases before each boundary.
6. Enable **Crossfade** ON with **ExoPlayer** ON — manual skip should crossfade natively; gapless album boundaries use a short ramp.
7. Optional: connect USB DAC on Android 14+ → enable **USB bit-perfect DAC** if probe shows available.

### Mini player limitations

- **OEM top pill / Dynamic Island**: Realme Mini Capsule, OnePlus Fluid Cloud, and similar UI are controlled by the phone manufacturer and appear only when the OS detects an active `MediaSession`. This app cannot draw a custom top pill on every device.
- **Picture in picture**: Requires Android 8+ and device PiP support. The floating window shows album art and system transport buttons; it is not a waveform visualizer.
- **System top bar**: Uses a default-importance notification channel so media appears prominently in the shade. Actual top-of-screen placement varies by Android version and OEM skin.

### Gradle sync (Android Studio)

1. Open the `android/` folder in Android Studio.
2. **File → Sync Project with Gradle Files** after pulling these changes.
3. Ensure SDK 36 and JDK 21 match `android/variables.gradle` / `capacitor.build.gradle`.

### Typecheck

```bash
npm run lint
npm run test
```

## Permissions (`AndroidManifest.xml`)

- `FOREGROUND_SERVICE`
- `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- `WAKE_LOCK`
- `POST_NOTIFICATIONS` (Android 13+, requested at runtime when playback starts)
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`

## Plugin API (JS)

- `BackgroundMedia.initialize()`
- `BackgroundMedia.configureAudioSession()` — STREAM_MUSIC volume keys, MODE_NORMAL, audio focus, returns `{ route, audioFocusGranted }`
- `BackgroundMedia.getAudioOutputRoute()` — `{ route: 'speaker' | 'bluetooth' | 'wired' | 'unknown' }`
- `BackgroundMedia.startForeground()` / `stopForeground()`
- `BackgroundMedia.updateMetadata({ title, artist, album?, artworkUrl? })`
- `BackgroundMedia.updatePlaybackState({ isPlaying, positionMs, durationMs })`
- `BackgroundMedia.setMiniPlayerMode({ mode: 'off' | 'pip' | 'topBar' })`
- `BackgroundMedia.enterPictureInPicture()` — manual PiP entry (also auto on Home when mode is `pip`)
- `BackgroundMedia.addListener('mediaAction', …)` — `play`, `pause`, `next`, `previous`, `seekForward`, `seekBackward`, `seekTo`

**`NativeExoPlayback` (default decode):**

- `NativeExoPlayback.getStatus()` — `{ available, wired, message, state?, positionSecs?, durationSecs?, queueIndex?, queueLength?, currentUrl?, gaplessEnabled? }`
- `NativeExoPlayback.prepare()` — initialize ExoPlayer instance
- `NativeExoPlayback.setGaplessEnabled({ enabled })` — sync gapless pref from Settings
- `NativeExoPlayback.setCrossfadeEnabled({ enabled, durationMs?, gaplessDurationMs? })` — native crossfade ramps
- `NativeExoPlayback.setReplayGainDb({ replayGainDb })` — mid-track loudness update (EBU proxy)
- `NativeExoPlayback.setBitPerfectEnabled({ enabled })` — USB bit-perfect experimental
- `NativeExoPlayback.getUsbBitPerfectSupport()` — `{ available, usbDacConnected, active, apiLevel }`
- `NativeExoPlayback.playUrl({ url, autoPlay?, replayGainDb?, resetQueue?, gaplessEnabled?, crossfade? })` — start HTTP(S) or `content://` decode
- `NativeExoPlayback.enqueueNext({ url, replayGainDb? })` — preload next track for gapless handoff
- `NativeExoPlayback.beginLockerBlob({ id, mimeType? })` / `appendLockerBlobChunk({ id, chunkBase64 })` / `finishLockerBlob({ id })` — offline IndexedDB → cache → `content://`
- `NativeExoPlayback.getLockerBlobUri({ id })` — reuse cached locker URI
- `NativeExoPlayback.addListener('playbackEvent', …)` — `mediaItemTransition` when queue advances
- `NativeExoPlayback.pause()` / `resume()` / `stop()` / `seek({ seconds })`

Wired from `sandboxLayer1.ts` (decode path) and `sandboxLayer3.tsx` (MediaSession metadata).

See also [android-wake-alarm.md](./android-wake-alarm.md) for the native wake alarm (`AlarmManager`).

For Android Auto browse/play foundation (not full certification), see [android-auto.md](./android-auto.md).
