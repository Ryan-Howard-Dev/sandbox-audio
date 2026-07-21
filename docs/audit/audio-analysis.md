# Pass 2 — Audio Pipeline & Playback Analysis

Subsystem: **Audio Pipeline & Playback** (decode/output path, stream URL resolution → audible output, native ExoPlayer, WebView audio, DAC routing, foreground service audio focus, prefetch buffers, gapless/crossfade at decode layer, playback speed, cast/speaker stream URLs). **Code-only audit — 2026-07-21.**

**Boundary vs [playback-queue-analysis.md](./playback-queue-analysis.md):** The queue pass owns `playQueue` / `queueIndex`, advance policy (`queueAdvancePolicy`, `subscribeEnded` orchestration in `sandboxLayer3`), persistence, and JS↔Exo index reconciliation triggers. **This pass** owns everything from tier resolve / envelope URL through decode, gain, routing, and OS audio session — including `playbackPipeline.executeTrack`, `useAudioFSM` load/attach, `trackPrefetch` buffer warming, and native plugin decode. Cross-reference only where queue advance *consumes* audio end events (`subscribeEnded`, `queueEnded`, `mediaItemTransition`); do not restate queue-index policy.

---

## Subsystem Interface

### Inputs

| Input | Source | Handler / module |
|-------|--------|------------------|
| Resolved or partial `MediaEnvelope` (title, url, provider, transport) | `handlePlayEnvelope` / prefetch / cast | `useAudioFSM.beginResolve` → `loadEnvelope` → `attachEnvelope` (`sandboxLayer1.ts`) |
| Tier-ordered stream resolve request | Play tap, prefetch, deferred side effects | `playbackPipeline.executeTrack` |
| Locker blob / `blob:` URLs | `lockerStorage`, IndexedDB | `nativeExoLockerBridge.registerLockerBlobContentUri`, `resolveNativeExoStreamUrlAsync` |
| Android native playback prefs | Settings | `androidNativePlaybackSettings`, `resolveNativeExoTransitionPrefs` (`androidWiredDacPlayback.ts`) |
| ReplayGain metadata | Locker ingest / envelope | `replayGainPlayback.ts` → Web Audio gain or `nativeExoSetReplayGainDb` |
| User volume / mute / playback rate | Player UI, keyboard | `setVolume`, `setPlaybackRate`, `applyPlaybackRate` (`sandboxLayer1`) |
| Podcast Smart Speed (variable rate) | Player settings | `podcastSmartSpeedController.ts` → `setPlaybackRate` (Web Audio path only) |
| Prefetch / prebuffer URL callbacks | Queue prefetch effects | `trackPrefetch.prefetchUpcomingQueueTracks` → `audio.prebufferUrl` |
| MediaSession / notification play-pause-seek | `MediaPlaybackForegroundService` | `backgroundMedia` `mediaAction` → shell bridges → `audio.pause` / `seek` |
| USB/wired route change | `BackgroundMedia` `audioRouteChange` | `initAndroidWiredDacStability` → `nativeExoRerouteToWired` |
| Audio focus loss/gain (OS) | FGS + `AndroidAudioSessionHelper` | `NativeExoPlaybackPlugin.pauseFromAudioFocusLoss`, `MediaPlaybackForegroundService.onAudioFocusChange` |
| Speaker cast play request | Cast picker / `castState` | `resolveSpeakerCastStreamUrl` (`castStreamResolver.ts`) → tier34 Sonos/UPnP |
| Cinema Chromecast load | `castSender.ts` | Web Cast SDK / `nativeCast` — separate from local decode path |

### Outputs

| Output | Consumer |
|--------|----------|
| Audible PCM (device speaker / BT / wired / USB DAC) | End user |
| `AudioFsmState` + position/duration/buffered | PlayerBar, scrobble, session recording |
| `nativeExoActive` / `nativeExoEffectivePlaying` | UI isPlaying, background media sync |
| Native Exo `MediaItem` queue (decode buffers) | Gapless handoff; queue pass reconciles index via URL |
| `playbackEvent` (`mediaItemTransition`, `queueEnded`) | `sandboxLayer1` → `sandbox-exo-media-transition` (queue pass) |
| Foreground notification + MediaSession metadata | Lock screen, headset keys |
| Resolved HTTP/`content://`/`file://` play URLs | ExoPlayer, HTMLAudio, cast receivers |
| Session play URL cache | `playUrlCache`, `streamCache` (IndexedDB) |
| Tier34 RAM staging side effect | `tier34StagePlaybackQueue` (server tmpfs) |

### State changes

- **FSM**: `Idle` → `Resolving` → `Connecting` → `Ready` / `Playing` / `Failed` (`useAudioFSM`).
- **Decode path refs**: `nativeExoRef`, `nativeAudiophileRef`, `prebufferRef`, `nativeExoEnqueueChainRef`, `nativeExoLastPrebufferRef`.
- **Native Exo mirrors**: `nativeExoEndedRef`, `nativeExoQueueAheadRef`, `nativeExoEffectivePlaying`, position anchors for poll reconciliation.
- **Web Audio graph**: `PlaybackCrossfadeRouter` bound element, replay gain, Sonic chain, podcast voice boost.
- **Android session**: `audioSessionConfigured`, `cachedAudioRoute`, FGS metadata revision counters.
- **Not in this subsystem**: `playQueue`, `queueIndex`, repeat/shuffle (queue pass).

### External dependencies

| Dependency | Role in audio pipeline |
|------------|-------------------------|
| `playbackPipeline` / `hybridResolution` / addons | Tier-ordered URL resolve before load |
| `tier34/client` | Server proxy, blob HTTP, cast stream, mobile resolve, staging |
| `lockerStorage` / `nativeExoLockerBridge` | Blob → durable `content://` for Exo |
| `NativeExoPlaybackPlugin` (Media3 ExoPlayer) | Primary Android decode outside WebView |
| `LockerBlobRegistry` (Java) | Durable filesDir blobs for `content://` |
| `MediaPlaybackForegroundService` | FGS, MediaSession, audio focus, notification |
| `AndroidAudioSessionHelper` | Pre-play audio focus, route detection, becoming-noisy |
| `BackgroundMediaPlugin` | Capacitor bridge for session + route events |
| `YoutubeDlStreamResolver` / `LocalStreamProxy` | YouTube watch → file/cache/proxy for Exo |
| `castStreamResolver` / `castState` | LAN HTTP URL for Sonos/UPnP (bypasses local decode) |
| Capacitor WebView `HTMLAudioElement` | Desktop + Android fallback / crossfade path |
| Tauri `nativeAudiophile` | Desktop native PCM path |

### Called by

- `sandboxLayer3` — `useAudioFSM()`, `audio.loadEnvelope`, `audio.prebufferUrl`, wired DAC init
- `trackPrefetch` — `resolvePlayableEnvelope`, `onResolvedUrl` → prebuffer
- `castState` — `resolveSpeakerCastStreamUrl` before remote play
- `backgroundMedia.syncAndroidBackgroundMedia` — from shell effects on position/metadata
- E2E (`e2eDevAction`) — direct `nativeExoPlayUrl` probes

### Calls into

- `executeTrack` / `resolveNativeExoStreamUrlAsync` / `registerLockerBlobContentUri`
- Capacitor plugins: `NativeExoPlayback`, `BackgroundMedia`
- Native: `nativeExoPlayUrl`, `nativeExoEnqueueNext`, `nativeExoSetPlaybackSpeed`, `nativeExoRerouteToWired`
- Web: `HTMLAudioElement`, `AudioContext` via `PlaybackCrossfadeRouter`

### Persistence

- **Play URL cache**: `playUrlCache` (session) — keyed by `playCacheKey(env)`; used by `executeTrack` and prefetch.
- **Stream cache**: IndexedDB via `streamCache` — Wi‑Fi/cellular prefetch of upcoming network tracks.
- **Locker blobs**: `LockerBlobRegistry` filesDir + IndexedDB; survives process restart (`warmFromDisk`).
- **Volume / gapless / crossfade / wired DAC prefs**: `sandboxSettings`, `androidNativePlaybackSettings`.
- **Not persisted**: Exo `MediaItem` queue, Web Audio graph state, in-flight resolve promises, ephemeral CDN URLs.

### Threading / async behaviour

- `executeTrack`: parallel tier queries with `PARALLEL_QUERY_DEADLINE_MS = 18_000`; per-tier `TIER_TIMEOUT_MS = 10_000`.
- `attachEnvelope`: async; stale loads dropped via `isStalePlayLoad` / play generation token.
- Native Exo `playUrl` for YouTube watch URLs: `playbackExecutor` (Java single-thread) then `runOnMain`.
- `prebufferUrl` → `nativeExoEnqueueNext`: serialized via `nativeExoEnqueueChainRef` promise chain.
- Native Exo status: shared poll (`subscribeNativeExoStatus`) 450–2800 ms depending on playing/battery saver.
- Locker blob bridge: chunked base64 writes with `yieldToMain` between chunks.
- FGS metadata: monotonic `revision` guards against stale async bridge updates.

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
    - src/replayGainPlayback.ts
    - src/playbackCrossfade.ts
    - src/castStreamResolver.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/MediaPlaybackForegroundService.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/AndroidAudioSessionHelper.java
  symbols:
    - useAudioFSM
    - attachEnvelope
    - executeTrack
    - prebufferUrl
    - resolveNativeExoStreamUrlAsync
    - NativeExoPlaybackPlugin.playUrl
    - MediaPlaybackForegroundService.onAudioFocusChange
  confidence: High
  evidence_type:
    - implementation
counter_evidence:
  files_inspected:
    - src/play/queueAdvancePolicy.ts
  note: queue advance policy intentionally out of scope for this pass
```

---

## Verified Facts (Only statements directly supported by code)

1. **Default Android decode path is native ExoPlayer outside the WebView** when `loadAndroidNativePlaybackEnabled()` is true and WebView crossfade is off (`isAndroidNativePlaybackLikely`).

```yaml
evidence:
  files:
    - src/androidNativePlayback.ts
  symbols:
    - isAndroidNativePlaybackLikely
    - shouldPreferAndroidNativePlayback
  confidence: High
  evidence_type:
    - implementation
```

2. **`attachEnvelope` selects decode backend in order**: Tauri audiophile (`nativeAudiophileRef`) → Android Exo (`nativeExoRef`, excluding podcast Web Audio effects) → WebView `HTMLAudioElement` + `PlaybackCrossfadeRouter`. Blob URLs on Android without `content://` resolution fail with `Failed`.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
  symbols:
    - attachEnvelope
    - envelopeNeedsAndroidNativeExo
    - podcastWebAudioEffectsRequired
  confidence: High
  evidence_type:
    - implementation
```

3. **`playbackPipeline.executeTrack`** resolves tiers (cache → locker shortcuts → hybrid → parallel tier queries → addons/mobile); never throws; returns envelope with URL or empty URL on failure. Distinct from queue index policy.

```yaml
evidence:
  files:
    - src/playbackPipeline.ts
  symbols:
    - executeTrack
    - firstResolvedTierQuery
    - TIER_TIMEOUT_MS
  confidence: High
  evidence_type:
    - implementation
```

4. **Locker blobs for Exo** are written to durable `filesDir` via `LockerBlobRegistry` (not cache dir); JS bridge chunks IndexedDB blobs through `beginLockerBlob` / `appendLockerBlobChunk` / `finishLockerBlob` → `content://` URI.

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
    - src/nativeExoLockerBridge.ts
  symbols:
    - beginLockerBlob
    - warmFromDisk
    - registerLockerBlobContentUri
  confidence: High
  evidence_type:
    - implementation
```

5. **`resolveNativeExoStreamUrlAsync`** order: `file://` as-is → HTTP/`content://` with `wrapGoogleStreamForExo` → Android locker `registerLockerBlobContentUri` → tier34 HTTP (`/api/cast/stream` or `/api/locker/blob`).

```yaml
evidence:
  files:
    - src/nativeExoStreamResolver.ts
  symbols:
    - resolveNativeExoStreamUrlAsync
    - wrapGoogleStreamForExo
    - isOfflineUnplayableStreamUrl
  confidence: High
  evidence_type:
    - implementation
```

6. **Native Exo gapless** uses Media3 `MediaItem` queue: `playUrl` with `resetQueue` / seek-to-existing-URL; `enqueueNext` appends without duplicate URL (`indexOfUrl`). `onMediaItemTransition` emits `playbackEvent` with `url`, `index`, `queueLength`. Queue-end emits `queueEnded`.

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
    - src/sandboxLayer1.ts
  symbols:
    - enqueueNext
    - onMediaItemTransition
    - initNativeExoPlaybackEvents
  confidence: High
  evidence_type:
    - implementation
```

7. **Wired DAC stability mode disables gapless and crossfade** at the native transition-prefs layer (`resolveNativeExoTransitionPrefs` returns `{ gapless: false, crossfade: false }`) and enlarges Exo buffer windows (`90_000–240_000 ms` min/max buffer vs `60_000–180_000` default).

```yaml
evidence:
  files:
    - src/androidWiredDacPlayback.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - resolveNativeExoTransitionPrefs
    - buildLoadControl
    - setWiredDacStabilityEnabled
  confidence: High
  evidence_type:
    - implementation
```

8. **WebView gapless** uses hidden `HTMLAudioElement` prebuffer (`prebufferRef`); seamless handoff promotes via `tryPromotePrebuffer`. Crossfade uses `PlaybackCrossfadeRouter.fadeOut` / `fadeIn` when crossfade+gapless enabled and not seamless.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/playbackCrossfade.ts
  symbols:
    - prebufferUrl
    - tryPromotePrebuffer
    - PlaybackCrossfadeRouter
  confidence: High
  evidence_type:
    - implementation
```

9. **Prefetch**: `PREFETCH_AHEAD = 5` for resolve+prebuffer; stream cache prefetch 1 track on cellular / 2 on Wi‑Fi. `primeLockerNativeQueue` enqueues locker `content://` URLs to native Exo via callback.

```yaml
evidence:
  files:
    - src/trackPrefetch.ts
  symbols:
    - PREFETCH_AHEAD
    - prefetchUpcomingQueueTracks
    - prefetchUpcomingIntoStreamCache
    - primeLockerNativeQueue
  confidence: High
  evidence_type:
    - implementation
```

10. **Playback speed** clamped 0.5–3.0: `audio.playbackRate` for WebView; `nativeExoSetPlaybackSpeed` → `player.setPlaybackSpeed` for Exo. Podcast Smart Speed disabled when `audio.nativeExoActive` or no Web Audio analyser.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/androidNativePlayback.ts
    - src/sandboxLayer3.tsx
    - src/podcastSmartSpeedController.ts
  symbols:
    - applyPlaybackRate
    - setPlaybackSpeed
    - startPodcastSmartSpeed
  confidence: High
  evidence_type:
    - implementation
counter_evidence:
  files_inspected:
    - src/lockerStorage.ts
  note: "nightcore" appears only in album-edition matching, not as a playback-speed preset
```

11. **ReplayGain**: `computePlaybackGainDb` applies EBU-style offset; Web Audio via `crossfadeRef.setReplayGainDb`; Exo via `setReplayGainDb` + per-queue-index gain map; USB bit-perfect bypasses app volume/gain (`shouldBypassAppVolume`).

```yaml
evidence:
  files:
    - src/replayGainPlayback.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - computePlaybackGainDb
    - applyCombinedVolume
    - nativeExoSetReplayGainDb
  confidence: High
  evidence_type:
    - implementation
```

12. **Foreground service + audio focus**: `MediaPlaybackForegroundService` requests `AUDIOFOCUS_GAIN`, handles `onAudioFocusChange` by pausing/resuming native Exo and emitting `mediaAction` to JS. Screen-lock keepalive can suppress focus-loss pause (`isScreenLockKeepaliveActive`). Separate `AndroidAudioSessionHelper.requestAppAudioFocus` called before Exo `playUrl`.

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/MediaPlaybackForegroundService.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/AndroidAudioSessionHelper.java
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - onAudioFocusChange
    - requestAppAudioFocus
    - onScreenOff
    - pauseFromAudioFocusLoss
  confidence: High
  evidence_type:
    - implementation
```

13. **`backgroundMedia.ts` header** states HTML5/Exo decode remains in WebView/native plugin; FGS mirrors state and forwards keys — `syncAndroidBackgroundMedia` skips WebView metadata sync when `nativeExoActive` (native owns lock-screen metadata during gapless).

```yaml
evidence:
  files:
    - src/backgroundMedia.ts
  symbols:
    - syncAndroidBackgroundMedia
    - configureAndroidAudioSession
  confidence: High
  evidence_type:
    - implementation
```

14. **Speaker cast** resolves locker blobs to tier34 LAN HTTP (`/api/cast/stream/{key}`) via `resolveSpeakerCastStreamUrl`; playback occurs on remote device, not through local Exo/HTMLAudio. Chromecast uses `castSender.ts` / `nativeCast` with `isCastAccessibleUrl` guard.

```yaml
evidence:
  files:
    - src/castStreamResolver.ts
    - src/castState.ts
    - src/castSender.ts
  symbols:
    - resolveSpeakerCastStreamUrl
    - isSpeakerCastableUrl
  confidence: High
  evidence_type:
    - implementation
```

15. **Truncated stream detection** on native Exo: when catalog duration ≫ Exo duration at queue end, dispatches `sandbox-playback-truncated` instead of firing `subscribeEnded`.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
  symbols:
    - maybeFireCatalogTrackEnd
    - nativeExoTruncatedHealRef
  confidence: High
  evidence_type:
    - implementation
```

---

## Architectural Interpretation (Inferences based on repository structure)

1. **Three-tier decode topology**: (a) Android Exo native default, (b) WebView HTMLAudio + optional Web Audio graph (crossfade, Sonic, podcast effects), (c) Tauri symphonia/cpal audiophile. Path selection is runtime-ref-based inside `useAudioFSM`, not a single strategy interface.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/playbackCrossfade.ts
    - src/nativeAudiophile.ts
  confidence: Medium
  evidence_type:
    - structure
```

2. **Resolve-then-decode is strictly upstream of FSM load**: `trackPrefetch` and `handlePlayEnvelope` call `executeTrack` / `resolvePlayableEnvelope` before `audio.loadEnvelope`; prefetch only warms URLs/buffers, not queue order (queue pass).

```yaml
evidence:
  files:
    - src/playbackPipeline.ts
    - src/trackPrefetch.ts
    - docs/audit/playback-queue-analysis.md
  confidence: Medium
  evidence_type:
    - structure
```

3. **Android background survival is split**: decode + gapless queue in `NativeExoPlaybackPlugin` (screen-off keepalive, native focus pause); process liveness + MediaSession in `MediaPlaybackForegroundService`; JS poll bridges UI when WebView throttled.

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
    - src/backgroundMedia.ts
  confidence: Medium
  evidence_type:
    - structure
```

4. **Cast is a parallel output path**: local pipeline resolves HTTP URL for remote pull; no shared decode session with Exo/HTMLAudio.

```yaml
evidence:
  files:
    - src/castStreamResolver.ts
    - src/castState.ts
  confidence: Medium
  evidence_type:
    - structure
```

5. **Wired DAC stability trades gapless for buffer depth** — intentional quality/stability tradeoff for USB bit-perfect routes.

```yaml
evidence:
  files:
    - src/androidWiredDacPlayback.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  confidence: Medium
  evidence_type:
    - structure
```

---

## Engineering Assessment (Quality judgments)

1. **Strength — layered OEM mitigations**: Screen-lock keepalive, native audio-focus pause without JS, enlarged DAC buffers, serialized `enqueueNext`, and `PREFETCH_AHEAD = 5` show deliberate OnePlus/aggressive-ROM hardening at the decode layer.

2. **Strength — honest resolve failure**: `executeTrack` never throws; offline unplayable URLs flagged (`isOfflineUnplayableStreamUrl`); blob→`content://` bridge with durable storage.

3. **Risk — JS FSM vs native audible desync**: `nativeExoEffectivePlaying` and status poll drive UI while `HTMLAudioElement` is detached/paused; maturity/truncation heuristics compensate but edge cases remain for short tracks and preview URLs.

4. **Risk — dual audio-focus holders**: `AndroidAudioSessionHelper` and `MediaPlaybackForegroundService` both request focus; native code documents OnePlus race where re-request during screen-off steals focus.

5. **Risk — server-dependent streams offline**: `wrapGoogleStreamForExo` and tier34 proxy paths fail or degrade without reachable Sandbox Server; `isOfflineUnplayableStreamUrl` blocks stale cached URLs.

6. **Risk — feature asymmetry on native Exo**: Podcast Smart Speed, Web Audio Sonic chain, and crossfade require WebView path; native Exo gets fixed `setPlaybackSpeed` only — Smart Speed explicitly disabled on Android native.

7. **Unknown — desktop Tauri audiophile parity with Android Exo gapless**: `nativeAudiophileRef` path exists; no native queue priming equivalent to `primeLockerNativeQueue` on Tauri in inspected files.

```yaml
evidence:
  files:
    - src/nativeAudiophile.ts
    - src/sandboxLayer1.ts
  confidence: Low
  evidence_type:
    - incomplete
counter_evidence:
  files_inspected:
    - src-tauri/
  note: Tauri native audio crate not fully traced in this pass
```

---

## Subsystem boundary summary

| Inside boundary (this pass) | Outside boundary (queue pass or other) |
|-----------------------------|----------------------------------------|
| `playbackPipeline.executeTrack`, tier resolve | `computeNextQueueIndex`, shuffle/repeat |
| `useAudioFSM` load/attach/play/pause/seek/rate | `handlePlayEnvelope` queue seeding/collapse |
| Native Exo decode, gapless `MediaItem` queue | JS `playQueue` list, `queueIndex` reconciliation policy |
| `trackPrefetch` URL resolve + prebuffer | `subscribeEnded` advance orchestration |
| Web Audio crossfade / replay gain / Sonic | Sovereign Up Next skip filtering |
| `backgroundMedia` FGS + audio session | MediaSession skip → `skipForward` queue policy |
| Wired DAC route recovery | Connect remote queue override |
| `castStreamResolver` HTTP URL for remotes | Full cast sender UI/session lifecycle |
| Locker blob → `content://` bridge | Locker sync mirror (except playable URL) |

**Cross-reference:** Queue pass documents `shouldSuppressJsAdvanceAfterNativeGapless`, `findQueueIndexForExoUrl`, and `primeLockerNativeQueue` invocation from `sandboxLayer3` — those bind queue policy to this decode layer; see [playback-queue-analysis.md](./playback-queue-analysis.md) and [playback-queue-invariants.md](./playback-queue-invariants.md).

**Top 3 risks (code-derived, audio-pipeline scope)**

1. **Native Exo audible while JS FSM lags** — UI/state/scrobble driven by polls and `nativeExoEffectivePlaying`; truncated-stream and maturity gates are partial mitigations; wrong metadata timing possible before `mediaItemTransition` reconcile (queue pass owns index fix).
2. **Blob/locker URL resolution failure blocks Android playback** — unresolved `blob:` cannot reach Exo; bridge depends on IndexedDB read + chunked native write; failure surfaces as `Failed` with no WebView fallback when native is preferred.
3. **Competing audio-focus + offline proxy dependency** — FGS and app helper both manage focus (documented OnePlus race); CDN/googlevideo and tier34 proxy URLs require server reachability for reliable Exo decode offline.
