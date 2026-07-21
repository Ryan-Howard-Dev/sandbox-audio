# Pass 2 — Audio Pipeline & Playback Invariants

Subsystem scope: stream URL resolution → decode/output path, `useAudioFSM`, `playbackPipeline`, prefetch/prebuffer, native ExoPlayer, WebView audio, DAC routing, foreground audio focus, playback speed/gain, cast stream URL resolution. **Code-only audit — 2026-07-21.** Queue index/advance invariants: [playback-queue-invariants.md](./playback-queue-invariants.md).

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| Android default decode must use ExoPlayer when native playback enabled and WebView crossfade disabled | WebView audio is throttled on lock screen; Exo decodes outside WebView | `isAndroidNativePlaybackLikely`: `loadAndroidNativePlaybackEnabled() && !loadAndroidWebViewCrossfadeEnabled()` | **Medium** — user enables WebView crossfade and silently opts out of Exo |
| `blob:` URLs must not reach Exo `playUrl` without prior `content://` or HTTP resolution | Exo rejects `blob:`; Capacitor bridge cannot stream object URLs | `nativeExoPlayUrl` throws on `blob:`; `attachEnvelope` fails with `Failed` when blob unresolved on Android | **High** — locker bridge timeout or missing IndexedDB row = no audible output |
| Locker blobs must persist in `filesDir`, not `cacheDir` | Cache purge wiped offline library historically | `LockerBlobRegistry` comment + `lockerDir(context)` under `filesDir/locker_blobs`; `warmFromDisk` on boot | **Low** — migration paths exist for legacy cache blobs |
| `executeTrack` must never throw; empty URL signals resolve failure | Play orchestration must not crash on tier timeout | `executeTrack` docstring + `firstResolvedTierQuery` deadline handling | **Low** — caller may treat empty URL as playable without checking `isFullStreamEnvelope` |
| Stale async loads must be ignored during `attachEnvelope` | Rapid skip/tap during tier resolve must not apply wrong track to decode | `isStalePlayLoad` + play generation in `attachEnvelope` / `loadEnvelope` | **Medium** — callers omitting `playToken` skip guard |
| Native Exo `enqueueNext` must be serialized on JS side | Out-of-order prefetch resolves must not reorder `MediaItem` queue | `nativeExoEnqueueChainRef` in `prebufferUrl`; `flushNativeExoEnqueueChain` after album prime (queue pass invokes) | **Medium** — `resetNativeExoEnqueueChain` on non-gapless stop drops pending enqueues |
| Gapless native handoff requires `resetQueue: false` and existing URL in Exo queue | Re-buffering current track causes audible gap | `runPlayUrlOnMain`: when `!resetQueue && gaplessEnabled`, seek to `indexOfUrl` instead of `clearMediaItems` | **High** — wrong `resetQueue`/`seamless` flags from caller force queue clear |
| Wired DAC stability mode must disable gapless and crossfade | Larger buffers + no crossfade prevent USB DAC underruns | `resolveNativeExoTransitionPrefs`: returns `{ gapless: false, crossfade: false }` when `loadAndroidWiredDacStabilityEnabled()` | **Low** — user expectation mismatch (gapless setting ignored on DAC mode) |
| Wired route recovery must not rebind preferred device on every tick while already playing on wired | Jul 14 hot-plug patch: pause/resume loops broke play start | `shouldSkipWiredRouteRecover`: skips when `prevRoute === 'wired' && playbackState === 'playing'` unless `becomingNoisyRecovered` | **Medium** — DAC micro-glitches may still need manual resume if debounce misses |
| Audio focus loss must pause native Exo even when JS bridge frozen | Screen lock freezes WebView; user expects duck/pause on calls | `pauseFromAudioFocusLoss` in `NativeExoPlaybackPlugin`; `MediaPlaybackForegroundService.onAudioFocusChange` → `emitAction("pause")` | **Medium** — screen-lock keepalive suppresses focus loss (`isScreenLockKeepaliveActive`) — intentional but can surprise |
| Re-requesting audio focus during screen-off keepalive must be avoided | Documented OnePlus race: second focus request pauses Exo | `onScreenOff` comment: "Do not re-request audio focus here" | **High** — regressions if future code calls `configureAndroidAudioSession` during keepalive |
| `syncAndroidBackgroundMedia` must not overwrite native Exo lock-screen metadata while native active | WebView position polls freeze; native plugin syncs FGS on transition | `syncAndroidBackgroundMedia`: early return when `nativeExoActive` and empty title or battery saver pause | **Medium** — stale WebView metadata if native sync fails |
| Playback speed must be clamped 0.5–3.0 on both WebView and Exo | Prevents player API rejection and chipmunk artifacts | `applyPlaybackRate` / `nativeExoSetPlaybackSpeed` / `NativeExoPlaybackPlugin.setPlaybackSpeed` | **Low** — podcast Smart Speed multiplies on top of user rate within same clamp |
| Podcast Smart Speed must not run on native Exo path | No Web Audio analyser on Exo; rate wobble fights `setPlaybackSpeed` | `sandboxLayer3`: skips `startPodcastSmartSpeed` when `audio.nativeExoActive \|\| !audio.getPlaybackLevelAnalyser()` | **Medium** — podcast on Android native gets fixed rate only |
| ReplayGain must apply on both paths: Web Audio gain node or Exo `replayGainLinear` | Consistent loudness across locker ingest metadata | `crossfadeRef.setReplayGainDb`; `nativeExoSetReplayGainDb`; `storeGainForIndex` per queue item | **Low** — USB bit-perfect bypasses app gain (`shouldBypassAppVolume`) |
| Offline cached URLs that require Sandbox Server must be skipped on resolve | Stale CDN/proxy URLs fail at Exo connect | `isOfflineUnplayableStreamUrl`; `executeTrack` `skipCached` when offline + proxy URL | **High** — user sees Failed/Connecting loop without server on googlevideo/proxy URLs |
| Googlevideo/YouTube CDN streams should route through tier34 proxy when server online | Direct CDN 403 in ExoPlayer | `wrapGoogleStreamForExo` + `nativeExoPlayUrl` appends client query for `/api/` URLs | **Medium** — offline falls back to raw URL (`logSuspectPlaybackUrl` warns) |
| Truncated stream end must not fire natural `ended` when catalog duration ≫ stream duration | Prevents false queue advance on preview/truncated mobile resolve | `sandboxLayer1` native poll: `looksTruncated` → `sandbox-playback-truncated` event instead of `endedListeners` | **Medium** — queue pass must handle heal; false advance if heuristic wrong |
| Speaker cast requires HTTP-accessible URL (not `blob:`) | Sonos/UPnP cannot fetch browser object URLs | `isSpeakerCastableUrl` rejects `blob:`; `resolveSpeakerCastStreamUrl` builds tier34 LAN URL | **High** — cast fails silently when LAN server unset |
| WebView gapless prebuffer promote must skip crossfade fadeOut on seamless handoff | 2.5s fade inserts silence when track already ended | `attachEnvelope`: `seamlessHandoff` bypasses `crossfadeRef.fadeOut` | **Medium** — missing `seamless: true` from queue advance causes gap |
| FGS metadata updates must respect monotonic revision | Stale async bridge calls must not rewind lock-screen title/art | `nextAndroidMediaMetadataRevision` / `applyMetadataRevision` in JS and Java | **Low** — race window if revision not passed |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/playbackPipeline.ts
    - src/trackPrefetch.ts
    - src/androidNativePlayback.ts
    - src/androidWiredDacPlayback.ts
    - src/backgroundMedia.ts
    - src/nativeExoStreamResolver.ts
    - src/nativeExoLockerBridge.ts
    - src/castStreamResolver.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/MediaPlaybackForegroundService.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
  symbols:
    - attachEnvelope
    - executeTrack
    - prebufferUrl
    - resolveNativeExoTransitionPrefs
    - wrapGoogleStreamForExo
    - pauseFromAudioFocusLoss
  confidence: High
  evidence_type:
    - implementation
```
