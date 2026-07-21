# Pass 2 — Playback & Queue Invariants

Subsystem scope: queue advance, audio FSM (`sandboxLayer1`), shell orchestration (`sandboxLayer3`), `src/play/*`, prefetch/resolve pipeline, Android ExoPlayer + MediaSession. **Code-only audit — 2026-07-21.**

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| Album/skip/advance must not collapse a multi-track queue to a single envelope when ref/state already hold the album | Premature collapse skips gapless native priming and breaks album continuity | `resolveActivePlayQueue` returns `collapsed: true` only when tap is absent from ref, state, and seed; `computePlayQueueSeed` builds album-ordered queue from `buildAlbumRenderRows` | **High** — React state lag vs `playQueueRef` can still yield wrong index if seed flags omitted on tap |
| Repeat-all must not wrap when the queue has ≤1 distinct `envelopeId` | Prevents infinite loop on a lone track with repeat-all enabled | `computeNextQueueIndex`: `distinct <= 1` → `{ action: 'none' }`; `computeNextQueueIndexWithUpNext` passes `countDistinctQueueEnvelopeIds` | **Low** — shuffle path can still pick same index randomly when `queueLength > 1` but only one distinct id |
| JS end-of-track advance is suppressed when native Exo already gapless-advanced ahead of the ended envelope (within 4s window) | Prevents double-resolve, double-advance, and audible glitches on OnePlus/OEM gapless | `shouldSuppressJsAdvanceAfterNativeGapless`: requires `seamless`, fresh `gaplessTransitionAtMs`, `queueIndex > endedIdx`, `playQueue.length > 1`; wired in `sandboxLayer3` `subscribeEnded` handler | **Medium** — suppression disabled when `queueIndex` still points at ended track (native queue exhausted); JS must advance |
| End-of-track advance requires mature playback (Playing FSM **or** ≥2s peak position) | Blocks spurious `ended` events before audible playback (OEM Exo reaches audio before JS FSM reports Playing) | `trackPlaybackMatureForAdvance` + `QUEUE_ADVANCE_MIN_PLAYED_SECONDS = 2`; gated in `subscribeEnded` before `computeNextQueueIndexWithUpNext` | **Medium** — very short tracks (<2s) may never auto-advance via JS ended path |
| Queue advance after natural end must call `handlePlayEnvelope` with `preservePlayQueue: true` | Keeps multi-track queue intact across tier resolve for next track | `subscribeEnded` advance branch: `playEnvelopeRef.current(track, …, { seamless, preservePlayQueue: true })` | **High** if caller omits flag — `resolveActivePlayQueue` collapses to `[env]` |
| Native Exo `enqueueNext` chain is serialized | Preserves album order when async prefetch resolves URLs out of order | `nativeExoEnqueueChainRef` in `sandboxLayer1.prebufferUrl`; `flushNativeExoEnqueueChain` awaited after locker album prime | **Medium** — `resetNativeExoEnqueueChain` on non-gapless stop clears pending enqueues |
| Native `mediaItemTransition` must reconcile JS `queueIndex` to Exo URL | JS UI/metadata must track native gapless auto-advance when WebView is throttled | `findQueueIndexForExoUrl` + `sandbox-exo-media-transition` listener in `sandboxLayer3`; native emits via `NativeExoPlaybackPlugin.onMediaItemTransition` → `sandboxLayer1` → `window` event | **High** — URL mismatch (locker blob vs `content://`) returns `idx < 0` and JS index stays stale |
| `playQueueRef` / `queueIndexRef` updated synchronously on collapse and out-of-sync repair | Refs are source of truth for ended/skip handlers that run outside React render | `handlePlayEnvelope` sets refs before async resolve; `playQueueRef.current = playQueue` in render-adjacent block | **Medium** — transient mismatch between React state and refs during async `handlePlayEnvelope` |
| Queue persistence writes only after restore attempt completes (`queuePersistReady`) and not on Connect remote | Avoids persisting partial boot state; remote role uses peer sync instead | `useEffect` guard `if (!queuePersistReady \|\| isConnectRemoteRef.current) return`; `saveQueueState` on queue/audio changes | **Low** — early session mutations before `queuePersistReady` are not persisted |
| Persisted current track id only when FSM is `Ready` or `Playing` | Prevents ghost player resurrecting mid-resolve URLs after reload | `persistableCurrentTrackId` in `queuePersistence.ts`; used in save effect | **Medium** — cold start / reload clears current track via `initPlaybackRestoreGuard` heuristics |
| Boot interactivity gate must not block playback handler registration indefinitely | Heavy vault work deferred; taps and E2E must still reach handlers | `initBootInteractivityGate`: first pointer/touch/keydown **or** 30s timeout releases gate; `releaseBootGateForE2e` for automation; E2E stubs register at `main.tsx` before `sandboxLayer3` chunk loads | **Low** for playback handlers — gate applies to deferred boot tasks (`runAfterBootInteractive` in `main.tsx`, locker heal), not `handlePlayEnvelope` registration |
| Stale async play loads must be ignored via play generation / play token | Rapid taps or skip during resolve must not apply outdated envelopes | `beginPlayIntent` / `isPlayIntentCurrent` in `handlePlayEnvelope`; `isStalePlayLoad` in `sandboxLayer1.attachEnvelope` | **Medium** — callers omitting `playToken` skip stale guard |
| Locker album playback primes native queue from current index | Gapless locker albums survive lock-screen WebView throttle | `primeLockerNativeQueue` + `primeLockerNativeQueueFrom` in `sandboxLayer3`; `isLockerVaultPlayQueue` guard | **Medium** — mixed locker/stream queues only prime locker tracks |
| Shared-stream album tracks seek in-place instead of re-resolve when URLs match | Avoids re-buffering single-file multi-track uploads | `tryQueueInPlaceSeek` / `shouldSeekQueueTrackInPlace` used in skip and ended advance paths | **Low** — requires identical resolved URLs in queue entries |
| Native Exo end at queue tail fires JS `subscribeEnded` once | Drives mix-radio extend, auto-similar-radio, or stop | `nativeExoEndedRef` + `atQueueEnd` check in `sandboxLayer1` native poll; `queueEnded` playback event also fires ended listeners | **Medium** — truncated-stream heal dispatches `sandbox-playback-truncated` instead of ended when catalog duration ≫ stream duration |
| MediaSession skip actions route through same skip handlers as UI | Lock-screen next/prev must match in-app queue policy | `MediaPlaybackForegroundService` `onSkipToNext/Previous` → `emitAction` → `backgroundMedia` `mediaAction` → `useAndroidShellBridges` → `skipForward`/`skipBack` | **Medium** — skip path bypasses `trackPlaybackMatureForAdvance` (only ended handler checks it) |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - src/play/queueAdvancePolicy.ts
    - src/play/queueAdvanceGate.ts
    - src/play/albumPlayQueue.ts
    - src/play/exoQueueSync.ts
    - src/sandboxLayer3.tsx
    - src/sandboxLayer1.ts
    - src/trackPrefetch.ts
    - src/queuePersistence.ts
    - src/bootInteractivity.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/NativeExoPlaybackPlugin.java
  symbols:
    - computeNextQueueIndex
    - resolveActivePlayQueue
    - shouldSuppressJsAdvanceAfterNativeGapless
    - trackPlaybackMatureForAdvance
    - primeLockerNativeQueue
  confidence: High
  evidence_type:
    - implementation
```
