# Pass 1 — Dependencies

Dependency inventory for **Sandbox Music** (`sovereign-music-console`). Generated from `package.json`, `src-tauri/Cargo.toml`, Android Gradle files, and import-graph sampling. **2026-07-21**.

---

## Internal modules

Major first-party modules and their relationships. Paths are relative to repo root.

| Module | Used by | Imports (key) | Purpose |
|--------|---------|---------------|---------|
| `src/main.tsx` | Vite entry | `sandboxLayer3`, `tier34/client`, `i18n` | App bootstrap, tier34 reachability probe, i18n init |
| `src/sandboxLayer3.tsx` | `main.tsx` | `sandboxLayer1`, `sandboxLayer2`, `play/*`, `stations/*`, `components/*`, `hooks/*`, `mobile/*`, `tier34/*`, `lockerStorage` | Main shell: navigation, play handler, queue, search UI, onboarding |
| `src/sandboxLayer1.ts` | `sandboxLayer3` | native playback bridges, `lastPlayIntent`, `playbackSession` | Audio FSM, native ExoPlayer poll, profile hooks |
| `src/sandboxLayer2.ts` | `sandboxLayer3` | `addons/searchProviders`, `playbackPipeline`, catalog modules | Provider layer: metadata fetch, tier resolution orchestration |
| `src/playbackPipeline.ts` | `sandboxLayer2`, `sandboxLayer3`, tests | `addons/searchProviders`, `tier34/client`, locker helpers | Multi-tier track resolve (locker → tier3/4 → addons) for playback |
| `src/lockerStorage.ts` | 80+ client modules, tier34 workers | IndexedDB APIs, `stations/theme` (display) | Locker IndexedDB (`SandboxMusicCoreDB`), blob storage, sync helpers |
| `src/tier34/client.ts` | 30+ modules (locker, cast, scrobble, search, stems, etc.) | `fetch`, env settings | HTTP client for Sandbox Server (`:3001`): health, search, stage, scrobble relay |
| `src/tier34/peerSync.ts` | `sandboxLayer3` | `connectProtocol`, WebSocket | Sandbox Connect playback-state sync over tier34 |
| `src/tier34/connectProtocol.ts` | `peerSync`, validation suite | — | Connect room protocol types and payloads |
| `src/play/*` (17 files) | `sandboxLayer3`, `sovereignUpNext`, tests | `lockerStorage`, `playbackSession`, native bridges | Queue advance gate, locker playable gate, Exo queue sync, radio dedupe |
| `src/stations/*` (31 files) | `sandboxLayer3`, `shell/lazyStationViews` | `components/*`, `hooks/*`, domain modules | Feature views: Home, Locker, Podcasts, Playlists, DJ, Settings, TV, etc. |
| `src/components/*` (~116 files) | `stations/*`, `sandboxLayer3`, `mobile/*` | hooks, domain modules | Reusable UI: PlayerBar, modals, sheets, onboarding, cast picker |
| `src/hooks/*` (20 files) | `sandboxLayer3`, `stations/*`, `components/*` | mobile/shell helpers | Shell state: mobile layout, badges, Android back, stem mix |
| `src/mobile/*` | `sandboxLayer3` | `components/*`, `stations/*` | Mobile dock, player shell, discover back navigation |
| `src/shell/lazyStationViews.tsx` | `sandboxLayer3` | `stations/*` (dynamic import) | Code-split station view loading |
| `src/addons/searchProviders.ts` | `playbackPipeline`, `sandboxLayer2`, `webCatalogSearch` | tier34 resolve routes (HTTP) | User manifest + experimental builtin addon search |
| `src/addons/addonUrlValidation.ts` | `addonStorage` | — | HTTPS manifest URL validation |
| `src/library/*` (3 files) | `stations/LibraryStationView` | `tier34/client` | Remote library server settings and browse API |
| `src/i18n/*` | `main.tsx`, UI components | locale JSON (`locales/*.json`) | i18n loader and 18 locale files |
| `server.ts` | `npm run dev`, `npm run build` | `express`, `vite`, `@google/genai`, `src/importPlatforms`, `src/playlistMetadataClient` | Port **3002**: Vite dev, catalog proxy, AI playlist curation, static `dist/` |
| `tier34-server/index.ts` | `npm run dev:tier34`, Docker | `express`, `ws`, `./lib/*`, `./routes/*` | Port **3001**: Sandbox Server HTTP + WebSocket hub |
| `tier34-server/routes/*` | `index.ts` | `lib/*` | Route handlers: subsonic, dlna, library, cast, stems, podcasts, platform |
| `tier34-server/lib/*` (~50 modules) | routes, workers, `index.ts` | `music-metadata`, `node-ssdp`, storage | Locker blobs, search, acquire worker, podcast mirror, DLNA, acoustid, demucs |
| `src-tauri/` (Rust) | `npm run tauri:*` | `tauri`, `symphonia`, `cpal`, `reqwest` | Desktop native shell, audiophile decode, taste signing |
| `android/` (Java/Kotlin plugins) | Capacitor | ExoPlayer, Media3, Cast, yt-dlp-android | Native playback, wake alarm, device scan, background media |

### Client domain clusters (flat `src/*.ts` files)

These are not subdirectories but are heavily imported across the tree:

| Cluster | Example files | Purpose |
|---------|---------------|---------|
| Locker | `lockerSync.ts`, `lockerMirror.ts`, `lockerSearch.ts` | Cross-device sync, mirror, Meilisearch client |
| Podcasts | `podcastStorage.ts`, `podcastPlayback.ts`, `podcastCatalog.ts` | RSS, offline episodes, chapters, smart speed |
| Playback | `playbackSession.ts`, `queueNavigation.ts`, `streamCache.ts` | Session types, queue persistence, stream cache |
| Catalog/search | `searchCatalog.ts`, `unifiedSearch.ts`, `webCatalogSearch.ts` | iTunes proxy search, unified search orchestration |
| Taste/playlists | `tasteFeedback.ts`, `likedPlaylist.ts`, `playlistStorage.ts` | Liked playlist, taste manifest, collaborative share |
| Android native | `androidNativePlayback.ts`, `backgroundMedia.ts`, `ytDlpMobile.ts` | Capacitor plugin bridges (`.ts` + `.web.ts` stubs) |

---

## External packages

### Node.js — root `package.json`

| Package | Version | Required/Optional | Purpose |
|---------|---------|-------------------|---------|
| `react` | ^19.0.1 | Required | UI framework |
| `react-dom` | ^19.0.1 | Required | DOM renderer |
| `vite` | ^6.2.3 | Required | Dev server and client bundler |
| `@vitejs/plugin-react` | ^5.0.4 | Required | React JSX/refresh for Vite |
| `@tailwindcss/vite` | ^4.1.14 | Required | Tailwind CSS v4 Vite plugin |
| `tailwindcss` | ^4.1.14 | Dev | CSS framework (dev dep; used at build) |
| `autoprefixer` | ^10.4.21 | Dev | CSS vendor prefixes |
| `typescript` | ~5.8.2 | Dev | Type checking (`npm run lint`) |
| `tsx` | ^4.21.0 | Dev | TypeScript execution for `server.ts`, tier34 dev |
| `esbuild` | ^0.25.0 | Dev | Bundle `server.ts` → `dist/server.cjs` |
| `vitest` | ^3.2.4 | Dev | Unit test runner |
| `concurrently` | ^9.1.2 | Dev | `dev:all` parallel UI + tier34 |
| `kill-port` | ^2.0.1 | Dev | Free port 3001 before tier34 restart |
| `vite-plugin-pwa` | ^1.3.0 | Dev | Service worker and web manifest |
| `workbox-window` | ^7.4.1 | Dev | PWA runtime (via vite-plugin-pwa) |
| `express` | ^4.21.2 | Required | UI server and tier34 HTTP |
| `ws` | ^8.18.1 | Required | tier34 WebSocket (peer-sync, jobs) |
| `dotenv` | ^17.2.3 | Required | Environment variable loading |
| `chokidar` | ^4.0.3 | Required | Filesystem watch (ingestion, beets sync) |
| `music-metadata` | ^11.0.2 | Required | Audio tag parsing (client + tier34) |
| `ip` | ^2.0.1 | Required | LAN IP discovery |
| `node-ssdp` | ^1.0.0 | Required | DLNA/SSDP discovery (tier34) |
| `lucide-react` | ^0.546.0 | Required | Icon components |
| `motion` | ^12.23.24 | Required | Animation (Framer Motion successor) |
| `@google/genai` | ^2.4.0 | Required | Gemini AI playlist curation in `server.ts` |
| `@capacitor/core` | ^8.4.0 | Required | Capacitor runtime |
| `@capacitor/cli` | ^8.4.0 | Required | `cap sync`, mobile tooling |
| `@capacitor/android` | ^8.4.0 | Required | Android platform package |
| `@capacitor/app` | ^8.1.0 | Required | App lifecycle events |
| `@capacitor/local-notifications` | ^8.2.0 | Required | Wake alarm / local notifications |
| `@tauri-apps/api` | ^2.11.0 | Required | Desktop Tauri JS API |
| `@tauri-apps/plugin-dialog` | ^2.7.1 | Required | Native file/folder dialogs |
| `@tauri-apps/cli` | ^2.11.2 | Dev | `tauri dev` / `tauri build` |
| `@types/express` | ^4.17.21 | Dev | TypeScript types |
| `@types/node` | ^22.14.0 | Dev | TypeScript types |
| `@types/ws` | ^8.5.14 | Dev | TypeScript types |

### Rust — `src-tauri/Cargo.toml`

| Package | Version | Required/Optional | Purpose |
|---------|---------|-------------------|---------|
| `tauri` | 2 | Required | Desktop app framework |
| `tauri-build` | 2 | Build | Tauri build scripts |
| `tauri-plugin-shell` | 2 | Required | Shell/open URL |
| `tauri-plugin-dialog` | 2 | Required | Native dialogs |
| `serde` / `serde_json` | 1 | Required | Config and IPC serialization |
| `symphonia` | 0.5 | Required | Audio decode (FLAC, MP3, AAC, etc.) |
| `cpal` | 0.15 | Required | Cross-platform audio output |
| `wasapi` | 0.13 | Required (Windows) | Windows audio backend |
| `reqwest` | 0.12 | Required | HTTP client (blocking) |
| `parking_lot` | 0.12 | Required | Synchronization primitives |
| `ed25519-dalek` | 2 | Required | Taste profile signing |
| `sha2` | 0.10 | Required | Hashing |
| `hex` | 0.4 | Required | Hex encoding |
| `thiserror` | 2 | Required | Error types |
| `rand_core` | 0.6 | Required | Crypto RNG |

### Android — `android/app/build.gradle` + `variables.gradle`

| Package | Version | Required/Optional | Purpose |
|---------|---------|-------------------|---------|
| Android Gradle Plugin | 8.13.0 | Required | Android build |
| `compileSdk` / `targetSdk` | 36 | Required | Android API level |
| `minSdk` | 24 | Required | Minimum Android 7.0 |
| `androidx.appcompat` | 1.7.1 | Required | AppCompat |
| `androidx.core:core-splashscreen` | 1.2.0 | Required | Splash screen |
| `androidx.media` | 1.7.0 | Required | Media session compat |
| `androidx.media3:media3-exoplayer` | 1.5.1 | Required | Native gapless playback |
| `androidx.media3:media3-common` | 1.5.1 | Required | Media3 shared types |
| `androidx.mediarouter` | 1.7.0 | Required | Cast route discovery |
| `play-services-cast-framework` | 21.5.0 | Required | Google Cast sender |
| `youtubedl-android` (library + ffmpeg) | 0.18.1 | Required | On-device yt-dlp for mobile resolver |
| `capacitor-android` | (from npm) | Required | Capacitor WebView bridge |
| JUnit / Espresso | (variables) | Dev | Android instrumented tests |

### Docker / runtime services (not npm)

| Service | Image / build | Required/Optional | Purpose |
|---------|---------------|-------------------|---------|
| Meilisearch | `getmeili/meilisearch:v1.12` | Optional (recommended) | Locker full-text search index |
| tier34 | `Dockerfile.tier34` | Optional | Containerized Sandbox Server |
| Demucs | `Dockerfile.demucs` / `docker/demucs-api.py` | Optional | Stem separation API |
| slskd | `slskd/slskd:latest` | Optional (`soulseek` profile) | Headless Soulseek client |
| Caddy / Headscale | `overlay/` + `docker-compose.overlay.yml` | Optional | HTTP/3 gateway, overlay VPN |

### System / CLI tools (documented, not package-managed)

| Tool | Required/Optional | Purpose |
|------|-------------------|---------|
| `yt-dlp` | Optional | Tier 3 proxy resolve on tier34 host |
| `fpcalc` (Chromaprint) | Optional | AcoustID fingerprinting |
| `demucs` | Optional | Stem separation (or Docker sidecar) |
| JDK 17+ | Required (Android build) | Gradle compilation |
| Android SDK | Required (Android build) | APK assembly |
| Node.js 20+ | Required | All JS builds |

---

## Dependency flow (simplified)

```
Browser/WebView/Tauri
    └── src/ (React client)
            ├── server.ts (:3002) ── catalog proxy, AI curation
            └── tier34-server (:3001) ── locker, search, acquire, DLNA, subsonic
                    ├── Meilisearch (:7700) [optional]
                    ├── Demucs [optional]
                    └── slskd [optional]
```
