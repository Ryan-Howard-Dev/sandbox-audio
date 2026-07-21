# Changelog

All notable changes to **Sandbox Music** (repo: `sovereign-music-console`) are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0-beta] — 2026-07-09

### Added

- **Liked playlist + thumbs** — System "Liked" playlist synced from taste feedback; thumbs up/down in player and artist views update liked state (`likedPlaylist.ts`, `tasteFeedback.ts`, `PlaylistsView.tsx`).
- **Downloaded tab (Podcasts)** — Library view for offline podcast episodes with filter and E2E drill-back coverage (`PodcastsView.tsx`, `e2eDevAction.ts`).
- **Skip Ad controls** — One-tap Skip Ad button with chapter-aware jumps and configurable fallback seek (`podcastAdSkip.ts`, `PodcastPlayerControls.tsx`).
- **Chapter auto-skip** — Optional setting to auto-skip labeled ad/sponsor chapters during podcast playback (`podcastSettings.ts`, `podcastChapterResolution.ts`).
- **Wired DAC stability mode** — Android setting disables gapless/crossfade when external DAC stability is preferred (`androidWiredDacPlayback.ts`, `androidNativePlaybackSettings.ts`); documented in tests, not yet a user-facing settings doc page.
- **Catalog singles vs albums partitioning** — One-track iTunes "albums" routed to Singles; multi-track releases stay in Albums; dedupe by normalized title+artist (`searchCatalog.ts`).

### Changed

- **Playback session separation** — Content-type guards (`music | podcast | radio`), atomic display seed, and seed-priority now-playing resolution prevent cross-wired metadata between locker and podcasts (`playbackSession.ts`).
- **Podcast playback path** — Dedicated branch in shell play handler; direct HTTPS enclosures; stale localhost proxy URLs unwrapped on native Android (`sandboxLayer3.tsx`, `podcastPlayback.ts`).
- **ExoPlayer HTTP headers** — Removed global YouTube `Referer` from all streams; per-URL headers only for YouTube/googlevideo (`NativeExoPlaybackPlugin.java`).
- **Native status poll guards** — Stale native `envelopeId` from previous track ignored during resolve (`lastPlayIntent.ts`, `sandboxLayer1.ts`).
- **Locker gate isolation** — Podcasts and HTTPS streams no longer enter locker repair paths or trigger "offline audio missing" toasts (`ensureLockerPlayable.ts`).
- **Playback preemption** — Music ↔ podcast session switches preempt cleanly; music-to-music may still use crossfade (`playbackSession.ts`).
- **Queue / Exo sync** — Native media-item transition events reconcile JS queue index with Exo URL (`exoQueueSync.ts`).
- **Scrub behavior** — Player bar scrub start/end wired through shell for native and Connect-remote paths (`PlayerBar.tsx`, `sandboxLayer3.tsx`).
- **Podcast UI controls** — Inline Skip Ad, speed/smart-speed/voice-boost toggles, chapter prev/next in now-playing (`PodcastPlayerControls.tsx`, `MobileNowPlayingView.tsx`).
- **Mobile browse menu filter** — Browse sheet lists only enabled stations (podcasts, sonic locker, etc.) based on settings flags (`sandboxLayer3.tsx`, `MobileNavMoreSheet.tsx`).
- **Mini player pause** — Mini bar pause/play uses same FSM path as full player; notification and lock-screen metadata stay in sync.
- **Layout / safe area** — Mobile shell padding and player chrome adjusted for system nav overlap (ongoing; see open items in `CODEBASE_HEALTH.md`).
- **Online search reliability** — Unified search debounce, catalog request generation guards, and hybrid resolution reduce stale results and race overwrites (`searchCatalog.ts`, `unifiedSearch.ts`, `hybridResolution.ts`).
- **Album track counts** — Artist discography shows accurate track counts after partition/dedupe passes (`searchCatalog.ts`, `ArtistDetailView.tsx`).
- **Brand name UI cleanup** — User-facing product name standardized to **Sandbox Music** in shell fallbacks and nav; legacy "Sovereign Music Console" strings remain in some desktop/DLNA metadata paths.

### Fixed

- **Podcast stuck at 0:00** — Exo HTTPS rejections and stale native poll status addressed (see Exo headers + status guards above).
- **Mixed now-playing metadata** — Episode art with locker title (e.g. Peter McCormack + Kanye KING) resolved via atomic display seed.
- **Locker hollow prune** — Metadata-only locker rows pruned from IndexedDB and hidden from UI; playable copy preferred on dedupe (`lockerStorage.ts`, `lockerPlayableFilter.ts`).

### Tests

- Playback session, podcast playback, locker gate, ad skip, liked playlist, Exo queue sync, wired DAC prefs, and catalog partition tests added or extended.
- Vitest: **541 passed / 3 failed** (see `CODEBASE_HEALTH.md` for failing files).
- Targeted playback suite from 2026-07-08 session: 22 tests passed (`playbackSession`, `podcastPlayback`, `ensureLockerPlayable`).

---

## [0.1.0] — prior development

Earlier milestones (multi-platform shell, locker sync foundations, Android Exo path, tier34 backend, CI, station lazy-loading) are summarized in [docs/CHRONICLE.md](./docs/CHRONICLE.md).

[0.2.0-beta]: https://github.com/SheepSkinRD/sandbox-music/compare/v0.1.0...v0.2.0-beta
