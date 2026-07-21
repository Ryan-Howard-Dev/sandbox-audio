# ADR 004: Android default decode uses native ExoPlayer outside WebView

## Status

Accepted

## Context

Android WebView audio is throttled on lock screen and lags behind native audible playback. Pass 2 audio and playback-queue audits document a **dual-queue architecture** on Android:

- **Logical queue:** JS `playQueue` / `queueIndex` in `sandboxLayer3.tsx`
- **Physical queue:** ExoPlayer `MediaItem` list in `NativeExoPlaybackPlugin`

Gapless playback uses native `enqueueNext`, `onMediaItemTransition` events, and JS reconciliation via `findQueueIndexForExoUrl`. Locker blobs require `content://` URIs (ADR 002).

Default path selection: when native playback is enabled and WebView crossfade is off, `isAndroidNativePlaybackLikely` routes decode to Exo.

## Decision

**Android default audio decode uses Media3 ExoPlayer via `NativeExoPlaybackPlugin`**, not WebView `HTMLAudioElement`, when:

- `loadAndroidNativePlaybackEnabled()` is true, and
- WebView crossfade is disabled (`!loadAndroidWebViewCrossfadeEnabled()`).

Supporting behaviors:

- `attachEnvelope` order: Tauri audiophile → Android Exo (excluding podcast Web Audio effects) → WebView fallback.
- Gapless: serialized `nativeExoEnqueueChainRef` for `enqueueNext`; `primeLockerNativeQueue` for locker albums.
- Queue sync: `exoQueueSync.ts` maps native transition URLs back to JS queue index.
- Advance suppression: `shouldSuppressJsAdvanceAfterNativeGapless` prevents double-advance when native gapless already moved ahead.
- Wired DAC stability mode disables gapless/crossfade and enlarges buffer windows.

Podcast Smart Speed, Web Audio Sonic chain, and crossfade require WebView path and are disabled on native Exo.

## Consequences

### Positive

- Reliable background/lock-screen playback on aggressive OEM ROMs.
- Gapless locker albums via native `MediaItem` queue and `PREFETCH_AHEAD = 5`.
- OEM mitigations: screen-lock keepalive, native audio-focus pause, maturity gates.

### Negative

- **Dual queue authority** — desync risk when URL matching fails (`idx < 0` silent return).
- JS FSM can lag native audible state; scrobble/UI metadata timing edge cases.
- Feature asymmetry: no Smart Speed / crossfade on native Exo path.
- Tauri desktop audiophile path has no evidenced equivalent to `primeLockerNativeQueue` (Pass 2 Low confidence unknown).

## Evidence

- `docs/audit/audio-analysis.md` — Verified Facts §1–2 (default Exo path, `attachEnvelope` order), §6 (gapless MediaItem queue)
- `docs/audit/audio-invariants.md` — Android Exo default; `blob:` rejection; gapless handoff rows
- `docs/audit/playback-queue-analysis.md` — Verified Facts §7–8 (native queue, transition events); Interpretation §2 (dual authority)
- `docs/audit/playback-queue-invariants.md` — suppress window, `findQueueIndexForExoUrl`, `primeLockerNativeQueue`
- `docs/audit/architecture-violations.md` — dual queue and JS/native advance race rows
