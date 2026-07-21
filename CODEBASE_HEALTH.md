# Codebase Health — 2026-07-09

Snapshot for **Sandbox Music** (`sovereign-music-console`). Documentation only; no refactor applied.

## Key file line counts

Measured with PowerShell `(Get-Content … | Measure-Object -Line).Lines` on 2026-07-09.

| File | Lines | Notes |
|------|------:|-------|
| `src/sandboxLayer3.tsx` | **8,040** | God-file — responsive shell, play handler, queue, search, JSX |
| `src/searchCatalog.ts` | 3,562 | Catalog search, artist discography, singles/albums partition |
| `src/lockerStorage.ts` | 3,084 | IndexedDB locker, hollow prune, sync helpers |
| `src/stations/PlaylistsView.tsx` | 2,955 | Playlists UI including system Liked playlist |
| `src/sandboxLayer1.ts` | 2,460 | Audio FSM, native poll, profile hooks |
| `src/e2eDevAction.ts` | 2,401 | Dev/E2E action registry and handlers |
| `src/sandboxLayer2.ts` | 1,790 | Providers & metadata layer |
| `android/.../NativeExoPlaybackPlugin.java` | 1,109 | Native ExoPlayer bridge |
| `src/components/PlayerBar.tsx` | 985 | Mini/full player chrome, scrub, controls |
| `src/stations/PodcastsView.tsx` | 679 | Podcast library, downloaded tab, filters |
| `src/unifiedSearch.ts` | 510 | Unified search orchestration |
| `src/lastPlayIntent.ts` | 303 | Play intent + native envelope matching |
| `src/playbackSession.ts` | 201 | Session type, display seed, preemption |
| `src/likedPlaylist.ts` | 123 | System Liked playlist sync |
| `src/podcastAdSkip.ts` | 96 | Skip Ad + chapter heuristics |
| `src/androidWiredDacPlayback.ts` | 103 | Wired DAC transition prefs |
| `src/play/exoQueueSync.ts` | 38 | Exo queue index reconciliation |
| `src/podcastPlayback.ts` | 147 | Podcast URL resolve helpers |
| `src/play/ensureLockerPlayable.ts` | 104 | Locker playback gate |
| `src/main.tsx` | 113 | App entry |

**Scale (approx.):** ~567 TS/Rust source files, ~120k LOC (per `docs/CHRONICLE.md`).

## Health assessment

### Strengths

- **Broad test coverage** — 124 Vitest files, 544 tests; strong coverage for playback, podcasts, locker, search, and catalog paths.
- **Partial shell extraction already done** — Hooks (`useMobileShell`, `usePlayerHomeNavigation`, `useAndroidShellBridges`, …) and lazy station chunks reduce initial bundle vs monolith baseline.
- **Playback logic modularizing** — `playbackSession.ts`, `podcastPlayback.ts`, `ensureLockerPlayable.ts`, `exoQueueSync.ts`, `play/*` policies extracted from the shell.

### Risks

| Area | Status |
|------|--------|
| **`sandboxLayer3.tsx` god-file** | 8k+ lines; single point for play, queue, search, Connect, downloads, and most JSX. Highest regression risk. |
| **TypeScript (`npm run lint`)** | **Fails** — 13 errors in `ensureLockerPlayable.ts`, `sovereignUpNext.ts`, `podcastTranscript.test.ts`, `tier34-server/routes/podcast*.ts`. |
| **Vitest** | **3 failing tests** — `lockerFuzzyMatch.test.ts`, `mobileAcquisition.test.ts`, `importPlaylistAcquisition.test.ts`. |
| **Phone E2E gate** | Scripts exist; not enforced on every release build. |
| **Safe-area / mobile layout** | User-reported overlaps; iterative fixes ongoing. |

### Recommendations (non-blocking)

1. Fix the 13 `tsc` errors before the next tagged release.
2. Stabilize the 3 failing unit tests or quarantine with tracked issues.
3. Execute the **split plan below** incrementally — do not big-bang refactor.
4. Keep phone playback E2E (uncached streams) in the release checklist.

---

## Split plan: `sandboxLayer3.tsx` only

**Goal:** Reduce `SandboxLayer3` to a thin orchestrator (~800–1,200 lines) without behavior changes. **Do not start until playback E2E is green on device.**

### Proposed modules

| New module | ~Lines moved | Responsibility |
|------------|-------------:|----------------|
| `src/shell/useShellSearch.ts` | 900 | Search input state, unified/catalog fetch, dropdown, history, `handleSelectSuggestion`, debounce/generation refs |
| `src/shell/usePlaybackQueue.ts` | 700 | `playQueue`, shuffle/repeat, add/remove/reorder, up-next merge, `handlePlayNext`, queue persistence hooks |
| `src/shell/usePlayEnvelope.ts` | 750 | `handlePlayEnvelope` body — resolve paths, locker gate, podcast branch, prefetch side effects |
| `src/shell/useShellPodcastControls.ts` | 400 | Speed, smart speed, voice boost, Skip Ad, chapter nav, podcast settings listeners |
| `src/shell/useShellDownloads.ts` | 350 | `handleDownloadTrack/Album/SearchHit`, cache actions, cellular notices |
| `src/shell/useShellConnect.ts` | 250 | Connect command dispatch, remote mirror, `sendConnectCommand` wiring |
| `src/shell/useShellNavigation.ts` | 400 | Station routing, back stack (`handleShellBack`), mobile tab/browse items, drill refs |
| `src/shell/ShellStationRouter.tsx` | 600 | JSX `switch (station)` — lazy station mounts and prop plumbing |
| `src/shell/ShellPlayerChrome.tsx` | 500 | PlayerBar / mobile now-playing props assembly, scrub, thumbs, now-playing display |
| `src/shell/ShellOverlays.tsx` | 400 | Queue drawer, lyrics, cast picker, sleep timer, onboarding/server setup gates |

After extraction, `sandboxLayer3.tsx` retains: provider composition, hook wiring, top-level layout skeleton, error boundaries, and E2E handler registration.

### Migration order

1. **Pure hooks with no JSX** (lowest risk): `useShellConnect` → `useShellPodcastControls` → `usePlaybackQueue`.
2. **Play path** (highest value, test-heavy): extract `usePlayEnvelope`; run `playbackSession`, `podcastPlayback`, `ensureLockerPlayable`, `exoQueueSync` tests after each step.
3. **Search** (many refs): extract `useShellSearch`; run `searchCatalog.*`, `unifiedSearch`, `webCatalogSearch` tests.
4. **Downloads / navigation**: `useShellDownloads`, `useShellNavigation`.
5. **JSX extractions last**: `ShellStationRouter` → `ShellPlayerChrome` → `ShellOverlays`; verify visually on Android + desktop.
6. **Final pass**: delete dead imports; confirm bundle chunks unchanged; run full Vitest + `npm run lint`.

### Boundaries to preserve

- Do **not** move `useAudioFSM` / profile — stay in `sandboxLayer1.ts`.
- Keep E2E registration (`registerE2eHandlers`) in shell root so `e2eDevAction.ts` contract stays stable.
- Lazy station imports stay in router module to preserve code-splitting.
- Shared refs (`playEnvelopeRef`, `handleShellBackRef`) use explicit context or ref bags — avoid circular hook imports.

### Success criteria

- `sandboxLayer3.tsx` under 1,500 lines.
- Zero behavior change: same Vitest count, same E2E handlers, same public exports.
- No new circular dependencies (`madge` or manual import audit).

---

See also: [CHANGELOG.md](./CHANGELOG.md) · [docs/CHRONICLE.md](./docs/CHRONICLE.md)
