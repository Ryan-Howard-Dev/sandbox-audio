# Pass 2 — Playback & Queue Analysis

Subsystem: **Playback & Queue** (canonical paths: `src/play/*`, `sandboxLayer3.tsx`, `sandboxLayer1.ts`, `trackPrefetch.ts`, `playbackPipeline.ts`, Android Exo + MediaSession). **Code-only audit — 2026-07-21.**

---

## Subsystem Interface

### Inputs

| Input | Source | Handler / module |
|-------|--------|------------------|
| User play tap (envelope + optional candidates) | UI stations, search, locker, playlists | `handlePlayEnvelope` (`sandboxLayer3.tsx`) |
| `seedSearchQueue` / album drill context | Search results, album drill state | `computePlayQueueSeed`, `seedSearchPlayQueue` |
| Skip next / skip back | PlayerBar, keyboard shortcuts, car mode | `skipForward`, `skipBack` (`sandboxLayer3.tsx`) |
| Natural track end | HTMLAudio `ended`, native Exo poll `stopped` at queue end, `queueEnded` event | `audio.subscribeEnded` listeners (`sandboxLayer1` → `sandboxLayer3`) |
| Native gapless transition | `NativeExoPlaybackPlugin.onMediaItemTransition` | `initNativeExoPlaybackEvents` → `sandbox-exo-media-transition` |
| MediaSession / notification controls | `MediaPlaybackForegroundService` | `backgroundMedia` `mediaAction` → `useAndroidShellBridges` |
| Connect remote commands | tier34 peer sync | `handleConnectCommand` (`SKIP_NEXT`, `ADD_TO_QUEUE`, etc.) |
| Queue restore on boot | `localStorage` / prefs | `loadQueueState` / `rehydrateQueueState` effect |
| E2E deep-link probes | `e2eDevAction.ts` | `installE2eLiveHandlers` (`playAlbumSequence`, `playLockerSequence`, …) |

### Outputs

| Output | Consumer |
|--------|----------|
| `playQueue: MediaEnvelope[]`, `queueIndex: number` | Player UI, Up Next, cast sync, Connect host publish |
| Audio FSM state (`Idle`…`Playing`…`Failed`) + `audio.envelope` | PlayerBar, scrobble, session recording |
| Native Exo `MediaItem` queue (`playUrl`, `enqueueNext`) | Android gapless playback off WebView |
| `saveQueueState` persisted snapshot | `queuePersistence.ts` / prefs |
| `syncAndroidBackgroundMedia` metadata + position | Lock-screen notification |
| Prefetch / stream-cache side effects | `trackPrefetch`, `streamCache`, tier34 stage queue |
| Mix-radio / auto-similar continuation | `tryExtendMixRadioQueue`, `startAutoSimilarRadioIfNeeded` |

### State changes

- **Queue state**: `setPlayQueue`, `setQueueIndex`, `shuffleOn`, `repeatMode`, `mixRadioSession`, sovereign Up Next settings.
- **Refs (handler-hot)**: `playQueueRef`, `queueIndexRef`, `trackReachedPlayingRef`, `exoGaplessTransitionAtRef`, `sessionPeakSecondsRef`.
- **Audio FSM**: `useAudioFSM` in `sandboxLayer1` — envelope attachment, native Exo activation, prebuffer chain.
- **Persistence**: debounced via `queuePersistReady` effect; `currentTrackId` gated by `persistableCurrentTrackId`.

### External dependencies

| Dependency | Role in subsystem |
|------------|-------------------|
| `playbackPipeline.executeTrack` | Tier-ordered URL resolve before load |
| `lockerStorage` | Locker blob → `content://` for Exo; queue rehydrate |
| `tier34/client` | Spectral check, heal, `tier34StagePlaybackQueue` |
| `androidNativePlayback` / `NativeExoPlaybackPlugin` | Native decode + gapless queue |
| `backgroundMedia` / `MediaPlaybackForegroundService` | FGS, MediaSession, headset keys |
| `sovereignUpNext` | Podcast-aware advance filtering |
| `queuePersistence` | Survive refresh / process kill |
| Capacitor WebView / HTMLAudio | Non-locker streams, desktop path |

### Called by

- `main.tsx` → renders `SandboxLayer3`
- Station views, `PlayerBar`, mobile shell, Android Auto bridge, cast, Connect client
- E2E bridge (`e2eHandlerBootstrap` stubs → live handlers)

### Calls into

- `sandboxLayer1.useAudioFSM` (load, play, subscribeEnded, prebufferUrl)
- `src/play/*` policy modules
- `trackPrefetch.prefetchUpcomingQueueTracks`, `primeLockerNativeQueue`
- `ensureLockerPlayable`, `runDeferredPlaySideEffects`
- Native: `nativeExoPlayUrl`, `nativeExoEnqueueNext`, `initAndroidBackgroundMedia`

### Persistence

- **Queue**: `QUEUE_STATE_KEY` (`sandbox_play_queue_state_v1`) — track refs rehydrated via locker snapshot + play history (`rehydrateQueueState`).
- **Last play intent**: `lastPlayIntent` when queue empty on restore.
- **Session marker**: `PLAYBACK_SESSION_KEY` in sessionStorage for cold vs in-tab resume.
- **Not persisted**: ephemeral stream URLs (sanitized on restore); Connect remote overrides local queue.

### Threading / async behaviour

- Play tap: `async handlePlayEnvelope` — `beginPlayIntent` generation token; stale loads dropped in `attachEnvelope`.
- Native Exo enqueue: serialized promise chain (`nativeExoEnqueueChainRef`); `flushNativeExoEnqueueChain` for album prime.
- Prefetch: fire-and-forget `inFlight` map in `trackPrefetch`; does not block UI.
- Ended handler: synchronous policy in `subscribeEnded` callback; `playEnvelopeRef.current` invoked without awaiting in some branches.
- Native events: `playbackExecutor` (Java) + main-thread Handler; JS receives Capacitor listener callbacks.
- Boot gate: `whenBootUiInteractive` promise queue — **does not gate** `handlePlayEnvelope`; defers locker heal / idle boot tasks only.

```yaml
evidence:
  files:
    - src/sandboxLayer3.tsx
    - src/sandboxLayer1.ts
    - src/play/playOrchestrationTypes.ts
    - src/queuePersistence.ts
    - src/bootInteractivity.ts
    - src/backgroundMedia.ts
    - src/hooks/useAndroidShellBridges.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - handlePlayEnvelope
    - useAudioFSM
    - subscribeEnded
    - initBootInteractivityGate
    - saveQueueState
  confidence: High
  evidence_type:
    - implementation
counter_evidence:
  files_inspected:
    - src/playbackEngineSettings.ts
  note: playbackEngineSettings.ts stores Prowlarr/RealDebrid/Discogs credentials only — not playback routing
```

---

## Verified Facts (Only statements directly supported by code)

1. **Queue state lives in `sandboxLayer3`**: `useState` for `playQueue` and `queueIndex`, mirrored to `playQueueRef` / `queueIndexRef` for ended and skip handlers.

```yaml
evidence:
  files:
    - src/sandboxLayer3.tsx
  symbols:
    - playQueue
    - queueIndex
    - playQueueRef
    - queueIndexRef
  confidence: High
  evidence_type:
    - implementation
```

2. **`computeNextQueueIndex` is the deterministic advance policy** for repeat-one, repeat-all (with distinct-track guard), shuffle random index, and end-stop.

```yaml
evidence:
  files:
    - src/play/queueAdvancePolicy.ts
  symbols:
    - computeNextQueueIndex
    - computeSkipBackIndex
  confidence: High
  evidence_type:
    - implementation
```

3. **`computeNextQueueIndexWithUpNext` wraps base policy** with sovereign Up Next unplayed-only skipping (`sovereignUpNext.ts`).

```yaml
evidence:
  files:
    - src/sovereignUpNext.ts
  symbols:
    - computeNextQueueIndexWithUpNext
  confidence: High
  evidence_type:
    - implementation
```

4. **Album play queue seeding** uses `buildAlbumRenderRows` order via `buildAlbumPlayQueueEnvelopes` / `computePlayQueueSeed`; synchronous seed applied in `handlePlayEnvelope` when `seedSearchQueue` is set.

```yaml
evidence:
  files:
    - src/play/albumPlayQueue.ts
    - src/sandboxLayer3.tsx
  symbols:
    - computePlayQueueSeed
    - seedSearchPlayQueue
  confidence: High
  evidence_type:
    - implementation
```

5. **`resolveActivePlayQueue` prevents queue collapse** when tapped envelope exists in ref or state queue, or `queueSeed` is present; collapse sets single-envelope queue and clears mix/radio session.

```yaml
evidence:
  files:
    - src/play/queueAdvanceGate.ts
    - src/sandboxLayer3.tsx
  symbols:
    - resolveActivePlayQueue
  confidence: High
  evidence_type:
    - implementation
```

6. **End-of-track handler** (`audio.subscribeEnded` in `sandboxLayer3`) runs: sleep timer check → playback maturity gate → native gapless suppress → repeat-one shortcut → sovereign Up Next podcast stop → `computeNextQueueIndexWithUpNext` → mix-radio extend or auto-similar radio → in-place seek or `handlePlayEnvelope` with `preservePlayQueue`.

```yaml
evidence:
  files:
    - src/sandboxLayer3.tsx
  symbols:
    - subscribeEnded
    - trackPlaybackMatureForAdvance
    - shouldSuppressJsAdvanceAfterNativeGapless
  confidence: High
  evidence_type:
    - implementation
```

7. **Native Exo maintains its own `MediaItem` queue**; JS prebuffers via `prebufferUrl` → `nativeExoEnqueueNext` on serialized chain when `nativeExoRef.current` is true and gapless enabled.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - prebufferUrl
    - enqueueNext
    - nativeExoEnqueueChainRef
  confidence: High
  evidence_type:
    - implementation
```

8. **`onMediaItemTransition` emits `playbackEvent`** with `url`, `index`, `queueLength`; JS maps URL back to queue index via `findQueueIndexForExoUrl` (raw URL match, then async locker resolve).

```yaml
evidence:
  files:
    - src/play/exoQueueSync.ts
    - src/sandboxLayer1.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - findQueueIndexForExoUrl
    - onMediaItemTransition
    - isExoMediaItemTransitionEvent
  confidence: High
  evidence_type:
    - implementation
```

9. **`PREFETCH_AHEAD = 5`** for queue prefetch; comment states intent to survive OEM WebView throttle on lock screen.

```yaml
evidence:
  files:
    - src/trackPrefetch.ts
  symbols:
    - prefetchUpcomingQueueTracks
    - PREFETCH_AHEAD
  confidence: High
  evidence_type:
    - implementation
```

10. **`playbackPipeline.executeTrack`** performs tier-ordered resolve (locker → tier34 → addons/mobile); used by `resolvePlayableEnvelope` and deferred side effects — not the queue index policy itself.

```yaml
evidence:
  files:
    - src/playbackPipeline.ts
    - src/trackPrefetch.ts
  symbols:
    - executeTrack
    - resolvePlayableEnvelope
  confidence: High
  evidence_type:
    - implementation
```

11. **Queue persistence** saves to prefs when `queuePersistReady` and not Connect remote; restore runs once in mount effect with locker warm + `rehydrateQueueState`.

```yaml
evidence:
  files:
    - src/queuePersistence.ts
    - src/sandboxLayer3.tsx
  symbols:
    - saveQueueState
    - loadQueueState
    - rehydrateQueueState
    - queuePersistReady
  confidence: High
  evidence_type:
    - implementation
```

12. **Boot interactivity gate** releases on first pointer/touch/keydown or 30s timeout; E2E can call `releaseBootGateForE2e`. Used from `main.tsx` `runAfterBootInteractive` for deferred boot — not referenced in `sandboxLayer3.tsx`.

```yaml
evidence:
  files:
    - src/bootInteractivity.ts
    - src/main.tsx
  symbols:
    - initBootInteractivityGate
    - runAfterBootInteractive
    - releaseBootGateForE2e
  confidence: High
  evidence_type:
    - implementation
counter_evidence:
  files_inspected:
    - src/sandboxLayer3.tsx
  note: no bootInteractivity imports in queue/play path
```

13. **E2E playback handlers** register via `installE2eLiveHandlers` in `sandboxLayer3`; stubs installed earlier from `e2eHandlerBootstrap` at `main.tsx` load. `playAlbumSequence` and `playLockerSequence` exercise multi-track advance.

```yaml
evidence:
  files:
    - src/e2eHandlerBootstrap.ts
    - src/e2eDevAction.ts
    - src/sandboxLayer3.tsx
  symbols:
    - installE2eLiveHandlers
    - playAlbumSequence
    - playLockerSequence
  confidence: High
  evidence_type:
    - implementation
```

14. **MediaSession skip** routes: `MediaPlaybackForegroundService.onSkipToNext` → `emitAction("next")` → `useAndroidShellBridges` → `skipForward` (same queue policy as UI, without maturity gate).

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/MediaPlaybackForegroundService.java
    - src/hooks/useAndroidShellBridges.ts
    - src/sandboxLayer3.tsx
  symbols:
    - onSkipToNext
    - skipForward
  confidence: High
  evidence_type:
    - implementation
```

---

## Architectural Interpretation (Inferences based on repository structure)

1. **Split-brain orchestration**: Pass 1 classifies `src/play/` as **Evolving** extraction from `sandboxLayer3.tsx`. Policy is modular (`queueAdvancePolicy`, `queueAdvanceGate`, `albumPlayQueue`, `exoQueueSync`) but **execution remains centralized** in `sandboxLayer3` (~9.5k lines) with extensive ref mirroring.

```yaml
evidence:
  files:
    - docs/audit/repository-map.md
    - src/sandboxLayer3.tsx
    - src/play/
  confidence: Medium
  evidence_type:
    - structure
```

2. **Dual queue authority on Android**: Logical queue (`playQueue` + `queueIndex`) and physical queue (Exo `MediaItem` list) are synchronized opportunistically via prefetch/`enqueueNext`, `mediaItemTransition` URL matching, and JS advance suppression — not a single source of truth.

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/sandboxLayer3.tsx
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - prebufferUrl
    - shouldSuppressJsAdvanceAfterNativeGapless
    - onMediaItemTransition
  confidence: Medium
  evidence_type:
    - structure
```

3. **Resolve-then-play pipeline is orthogonal to queue index policy**: `playbackPipeline` / `trackPrefetch` answer "what URL plays"; `queueAdvancePolicy` answers "which envelope is next". `handlePlayEnvelope` bridges both.

```yaml
evidence:
  files:
    - src/playbackPipeline.ts
    - src/play/queueAdvancePolicy.ts
    - src/sandboxLayer3.tsx
  confidence: Medium
  evidence_type:
    - structure
```

4. **Android background path is notification/control-plane, not decode-plane** for most streams: `backgroundMedia.ts` header states HTML5/Exo still in WebView/native plugin; FGS mirrors state and forwards keys.

```yaml
evidence:
  files:
    - src/backgroundMedia.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/MediaPlaybackForegroundService.java
  confidence: Medium
  evidence_type:
    - structure
```

5. **`playbackEngineSettings.ts` is misnamed relative to queue subsystem** — it only persists indexer/debrid API credentials, not Exo/gapless/prefetch settings (those live elsewhere: `resolveNativeExoTransitionPrefs`, `sandboxSettings`).

```yaml
evidence:
  files:
    - src/playbackEngineSettings.ts
  confidence: High
  evidence_type:
    - implementation
```

---

## Engineering Assessment (Quality judgments)

1. **Strength — explicit advance invariants with tests**: `queueAdvancePolicy`, `queueAdvanceGate`, `albumPlayQueue`, `exoQueueSync` have dedicated unit tests; anti-double-advance and anti-collapse logic is documented in function comments.

2. **Strength — OEM-aware gapless handling**: Maturity gate, JS suppress window, screen-lock keepalive in native plugin, and `PREFETCH_AHEAD = 5` show deliberate OnePlus/WebView throttle mitigation.

3. **Risk — god-file coupling**: Queue advance, prefetch, persistence, Connect, cast, and E2E handlers interleave in `sandboxLayer3` with many refs; regression surface is large despite extracted policies.

4. **Risk — URL-based Exo↔JS index reconciliation**: `findQueueIndexForExoUrl` depends on URL equivalence after async locker resolution; failure mode is silent (`idx < 0` early return) leaving stale UI index.

5. **Risk — ended vs skip policy asymmetry**: `trackPlaybackMatureForAdvance` applies only to natural end, not `skipForward`; intentional for UX but can mask spurious ended events if skip path used.

6. **Unknown — desktop/Tauri queue parity**: Audit scope emphasized Android Exo; Tauri native path in `sandboxLayer1` (`nativeAudiophileRef`) participates in FSM but queue native priming is Android-specific (`primeLockerNativeQueue`).

```yaml
evidence:
  files:
    - src/sandboxLayer1.ts
    - src/trackPrefetch.ts
  confidence: Low
  evidence_type:
    - incomplete
counter_evidence:
  files_inspected:
    - src-tauri/
  note: Tauri shell not in Pass 2 scope list
```

---

## Subsystem boundary summary

| Inside boundary | Outside boundary |
|-----------------|------------------|
| Queue list, index, repeat/shuffle, advance on end/skip | Station navigation UI, search catalog fetch |
| `handlePlayEnvelope` orchestration | Gemini playlist curation (`server.ts`) |
| Audio FSM + native Exo bridge | tier34-server acquire workers |
| Prefetch/stage upcoming tracks | Locker sync mirror (except playable resolution) |
| Queue persistence + restore | Connect protocol definition (consumes commands) |
| MediaSession control forwarding | Full cast sender implementation |

**Top 3 risks (code-derived)**

1. **Dual queue desync (JS `playQueue` vs Exo `MediaItem` queue)** — reconciliation hinges on URL matching and timed JS suppress; failure leaves wrong track metadata or duplicate advance.
2. **`sandboxLayer3` concentration** — queue behaviour split across refs, effects, and async handlers in one file; extracted policies reduce but do not remove regression risk.
3. **WebView FSM lag vs native audible playback** — maturity and gapless suppress gates exist because JS state trails Exo; edge cases remain for short tracks and exhausted native queues.
