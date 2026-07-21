# Offline Capability Audit

Sovereign Music Console — PWA, Android (Capacitor), and Tauri (desktop static client).

**Supported platforms:** Web/PWA, Tauri (Windows + Linux), Android. iOS and macOS desktop: planned for a future release.

Last audited: 2026-06-09.

## Summary

The app is **locker-first**, not fully offline-first. IndexedDB locker playback, playlists, and on-device search matching work without internet. Catalog discovery, acquisition, Feed, Connect, cast discovery, and Meilisearch full-text search depend on network paths documented below.

There is **no Spotify-scale catalog** — search and artist pages use an iTunes metadata proxy merged with locker content. That is expected for self-hosted use, not a missing feature.

**Air-Gap Mode** (`src/airGapMode.ts`) is the strongest offline control: it patches `fetch` to block outbound catalog/metadata/acquire routes while allowing same-origin assets, localhost, and LAN tier34 locker/graph/search (except tier34 routes that reach the public internet).

## Platform notes

| Platform | Shell | Offline shell | Locker storage | Tier34 reach |
|----------|-------|---------------|----------------|--------------|
| **PWA** | Vite + `vite-plugin-pwa` | Service worker precaches JS/CSS/HTML; `navigateFallback: index.html`; iTunes `NetworkFirst` runtime cache | IndexedDB (`lockerStorage.ts`) | User-configured URL; localhost or LAN |
| **Android** | Capacitor WebView (`capacitor.config.ts`) | Same web bundle as PWA; no separate SW unless installed as PWA | IndexedDB + optional `LocalSQLite` plugin | LAN tier34 typical on home network |
| **Tauri** | Embedded `dist/` (`src-tauri/tauri.conf.json`) | Static assets local; no Workbox SW in desktop shell | IndexedDB | localhost or LAN tier34 |

Platform differences for **offline behavior are minimal** — all three run the same React shell. Differences are mainly install/distribution (SW on PWA, native background audio on Android, Tauri audiophile path).

**Mobile UI:** Web/PWA clients at viewport widths **≤767px** (iPhone Safari, installed PWA home screen) use the same Tidal-style mobile shell as Android native — bottom nav, vinyl home, now-playing overlay. Tauri desktop always uses the desktop shell regardless of window size.

## Failure scenarios

| Scenario | Detection | User-visible signal |
|----------|-----------|---------------------|
| **Internet down** | `navigator.onLine`, failed catalog/metadata fetches | Shell badge "No Internet"; search placeholder/hint; catalog empty |
| **Tier34 down** | `tier34HealthOk()` / Sovereign System Status | Shell badge "Tier34 Offline"; Feed/Connect/acquire/sync messages |
| **Meilisearch down** | tier34 `/health` `meilisearch: false`; search `ok: false` | Locker search degraded banner; on-device fallback |
| **Air-Gap Mode** | `sandbox_air_gap_mode` pref | Shell badge "Air-Gap Mode"; Settings security copy |

## Feature matrix

Legend: **Works** = core function usable | **Degraded** = partial/fallback | **Fails loud** = visible error/banner/toast | **Fails silent** = empty/no results without explanation (pre-audit gaps marked; messaging added where noted).

### Internet unavailable

| Feature | PWA | Android | Tauri | Notes |
|---------|-----|---------|-------|-------|
| Catalog search (iTunes proxy) | Degraded | Degraded | Degraded | Returns empty; unified search still scans local locker |
| Artist images | Fails silent → **hint** | Same | Same | Seed gradients used; `searchOfflineHint` explains |
| iTunes API | Fails silent | Same | Same | Cached SW entries may serve stale PWA results only |
| Locker playback (IndexedDB) | **Works** | **Works** | **Works** | `refreshLockerEntryPlayUrl` recovers blob URLs |
| Playlists | **Works** | **Works** | **Works** | localStorage / prefs |
| Stream cache replay | **Works** | **Works** | **Works** | If previously cached |
| Podcast RSS / YouTube | Fails loud | Same | Same | Views show errors when fetches fail |

### Tier34 unavailable

| Feature | PWA | Android | Tauri | Notes |
|---------|-----|---------|-------|-------|
| Feed | Fails loud | Same | Same | `FeedView` offline banner |
| Acquire / download jobs | Fails loud | Same | Same | `DownloadErrorToast`; Settings acquire banner |
| Connect (peer-sync) | Fails loud | Same | Same | Settings Connect banner; sovereign status OFFLINE |
| Meilisearch proxy (`/api/search`) | Degraded | Same | Same | Falls back to IndexedDB scan |
| Cast LAN discover | Fails loud | Same | Same | `CastPicker` error message |
| Locker blob sync | Fails loud | Same | Same | Sovereign LOCKER SYNC offline reason |
| Locker playback (device blobs) | **Works** | **Works** | **Works** | Does not require tier34 for local blobs |
| Locker playback (`/api/locker/blob/…` URL) | Degraded | Same | Same | `handlePlayEnvelope` upgrades to IndexedDB blob when `sourceId` known |
| DLNA | Fails loud | Same | Same | Sovereign status |
| Media graph stats (Settings) | Fails silent → hint | Same | Same | "Start tier34…" copy |

### Meilisearch unavailable (tier34 up)

| Feature | PWA | Android | Tauri | Notes |
|---------|-----|---------|-------|-------|
| Locker full-text search | Degraded | Same | Same | `tier34-server` returns `ok: false`; client uses `searchLockerLocalFallback` |
| Faceted locker filters | Degraded | Same | Same | Facets empty offline; basic filters on local scan |
| Unified search dropdown | Degraded | Same | Same | `runUnifiedSearch` still includes `scanLocalLocker` |
| Catalog / acquire | **Works** | **Works** | **Works** | Independent of Meilisearch |
| Reindex button (Settings) | Fails loud | Same | Same | HTTP 503 with message |

## Graceful degradation paths (existing code)

| Path | Location | Behavior |
|------|----------|----------|
| Air-Gap fetch guard | `airGapMode.ts`, `fetchWithTimeout.ts`, `main.tsx` | Blocks outbound proxy paths; 451 JSON response |
| Air-gap catalog short-circuit | `searchCatalog.ts`, `exploreCatalog.ts`, `acquisitionPipeline.ts` | Empty catalog / throws on acquire |
| Local locker catalog merge | `searchCatalog.ts` `fetchLocalSearchCatalog` | IndexedDB when Meilisearch empty |
| Unified search local scan | `unifiedSearch.ts` `scanLocalLocker` | Always runs parallel to Meilisearch |
| Locker search local fallback | `lockerSearch.ts` `searchLockerLocalFallback` | IndexedDB token match (added in audit) |
| Locker playback blob refresh | `lockerStorage.ts`, `sandboxLayer3.tsx` | `refreshLockerEntryPlayUrl` on play and on Failed |
| Stream cache | `streamCache.ts` | Manual and post-play cache |
| Feed empty state | `FeedView.tsx` | Context-aware offline message |
| Sovereign System Status | `sovereignSystemStatus.ts` | Per-service OFFLINE/DISABLED/ERROR reasons |
| Connect / cast guards | `tier34/client.ts`, `CastPicker.tsx` | `tier34HealthOk` before discover |
| PWA asset shell | `vite.config.ts` Workbox | App UI loads without network after first visit |

## Air-Gap Mode behavior

When enabled (Settings → Security → Air-Gap Mode):

- **Blocked**: `/api/catalog/*`, metadata, artist-image, podcast proxies, oembed, tier34 acquire/resolve/debrid/podcast outbound routes, non-LAN external hosts.
- **Allowed**: Same-origin app assets, `blob:`/`data:`, localhost and RFC1918 tier34 locker blobs, search/graph on LAN (except blocked tier34 outbound routes).
- **Works**: Locker playback, playlists, on-device search, LAN tier34 locker APIs that do not trigger outbound internet.
- **User signal**: Fixed shell badge, search placeholder, Settings description.

## Messaging added (this audit)

| Surface | Component / file | Message |
|---------|------------------|---------|
| Shell connectivity | `offlineStatus.ts`, `sandboxLayer3.tsx` | Badge: Air-Gap / No Internet / Tier34 Offline |
| Search bar | `sandboxLayer3.tsx` | Dynamic placeholder + `searchOfflineHint` |
| Search dropdown | `SearchDropdown.tsx` | Empty-state offline hint |
| Search results | `SearchResultsView.tsx` | Meilisearch degraded + empty-state hint |
| Feed | `FeedView.tsx` | `OfflineStatusBanner` |
| Locker search | `LockerSearchView.tsx` | Degraded banner + on-device fallback |
| Settings Connect | `SettingsView.tsx` | Connect offline banner |
| Settings Acquire | `SettingsView.tsx` | Acquire limited banner |
| Reusable banner | `components/OfflineStatusBanner.tsx` | Consistent inline pattern |

## High-impact fixes (this audit)

1. **Locker search on-device fallback** when Meilisearch or tier34 search proxy fails (`lockerSearch.ts`, `LockerSearchView.tsx`).
2. **Local vault playback recovery** on Failed state — retry `refreshLockerEntryPlayUrl` instead of skipping heal (`sandboxLayer3.tsx`).
3. **Unified offline status polling** (`offlineStatus.ts`, `useOfflineStatus`) aligned with Sovereign System Status semantics.

## What still fails without explanation (low priority)

- Explore station chart queries when offline (empty list).
- Artist detail discography partial load when catalog unreachable (local tracks only, no banner).
- Cinema cast remote session when offline (overlay path may still work).
- Tauri audiophile mode requires HTTP(S) URL — local `blob:` falls back to Web Audio (logged, not toasted).

## Verification checklist

- [ ] Disable network: search shows locker results only; badge and hint visible.
- [ ] Stop tier34: Feed banner, Connect banner, cast discover error; locker play from Collection works.
- [ ] Stop Meilisearch (tier34 up): locker search uses on-device fallback; Settings shows MEILISEARCH error.
- [ ] Enable Air-Gap: catalog blocked; LAN tier34 locker still reachable; badge shows Air-Gap Mode.
- [ ] PWA: reload offline — shell loads from service worker.
- [ ] Android / Tauri: same flows in WebView / webview shell.

## Related files

- `src/airGapMode.ts` — air-gap policy
- `src/offlineStatus.ts` — connectivity snapshot and copy helpers
- `src/sovereignSystemStatus.ts` — Settings service matrix
- `src/unifiedSearch.ts` — unified search orchestration
- `src/lockerSearch.ts` — locker search shaping + local fallback
- `vite.config.ts` — PWA / Workbox
- `capacitor.config.ts` — Android shell
- `src-tauri/tauri.conf.json` — desktop shell
