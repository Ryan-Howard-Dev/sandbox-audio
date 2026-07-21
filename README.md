# Sandbox Music

**Sandbox Music** (`sovereign-music-console`) is a self-hosted **music and podcast player** with a local locker, catalog explorer, and optional Sandbox Server backend. It ships as **web/PWA**, **Tauri desktop** (Windows + Linux), and **Android** (Capacitor).

Play your own files offline, stream from a home **Sandbox Server**, subscribe to podcasts, and browse catalog metadata — without a commercial streaming subscription.

> **Beta software.** Expect rough edges in playback, mobile layout, and search. Not recommended as a daily driver without backups of your locker data.

**Supported platforms (audit-verified):** Web/PWA, Tauri desktop (Windows + Linux), Android (Capacitor). iOS and macOS desktop are not in current CI or release artifacts per existing README scope.

Catalog discovery uses an **iTunes metadata proxy plus your local locker** — not a Spotify-scale streaming catalog.

## What the app does

- **Local locker** — IndexedDB vault for imported audio; Android mirrors blobs to durable `filesDir` for native playback ([adr/002-native-filesdir-not-cache.md](./adr/002-native-filesdir-not-cache.md)).
- **Catalog browse** — iTunes and related metadata via UI server (port 3002); full-track playback beyond previews requires Sandbox Server tier resolve.
- **Sandbox Server (tier34)** — Self-hosted Node API on port **3001** for acquire, locker sync, search proxy, Feed, Connect, DLNA, and debrid resolve when configured.
- **Playback** — Hybrid tier-ordered resolve (locker → cache → tier34 → mobile → preview); Android defaults to native ExoPlayer outside WebView ([adr/004-exoplayer-native-android-path.md](./adr/004-exoplayer-native-android-path.md)).
- **Cross-device** — Phones connect to tier34 on LAN; desktop anchor mode can auto-start bundled tier34 ([adr/003-bundled-tier34-tauri-desktop.md](./adr/003-bundled-tier34-tauri-desktop.md)).

Locker metadata is **never auto-deleted** in production; user-confirmed deletes only ([adr/001-locker-never-auto-delete.md](./adr/001-locker-never-auto-delete.md)).

## Three-layer architecture

| Layer | File | Responsibility |
|-------|------|----------------|
| **Layer 1** | `src/sandboxLayer1.ts` | Audio FSM, native Exo poll, profiles |
| **Layer 2** | `src/sandboxLayer2.ts` | Providers, metadata, search orchestration |
| **Layer 3** | `src/sandboxLayer3.tsx` | Shell UI, stations, player, Connect |

Entry: `src/main.tsx` → `sandboxLayer3.tsx`.

See [docs/sandbox-architecture.md](./docs/sandbox-architecture.md) (note: Pass 3 documents drift on packaged tier34 — prefer [adr/003](./adr/003-bundled-tier34-tauri-desktop.md)).

## How to run

### Development (audit-verified)

```bash
npm install
npm run dev          # UI on http://localhost:3002
```

Full local stack (UI + Sandbox Server):

```bash
npm run dev:all      # UI :3002 + tier34 :3001
```

Separate terminals:

```bash
npm run dev:tier34   # Sandbox Server only (:3001)
npm run dev          # UI only (:3002)
```

### Production web (UI server only)

```bash
npm run build        # dist/ + dist/server.cjs
npm start            # UI server only — does NOT start tier34
```

### Docker self-host (tier34 + Meilisearch)

```bash
docker compose up -d
npm run dev          # UI in separate terminal; set Server URL to http://localhost:3001
```

See [SELF_HOST.md](./SELF_HOST.md).

### Desktop (Tauri)

**Prerequisites:** Node.js 20+, Rust, platform SDKs (per [BUILDING.md](./BUILDING.md)).

```bash
npm install
npm run tauri:dev    # Dev window → http://localhost:3002
npm run build:desktop   # Installers + bundled tier34-server.mjs
```

Packaged desktop bundles `dist/tier34-server.mjs`. Anchor mode auto-starts tier34 on shell mount when enabled. **Windows** bundles portable Node; **Linux/macOS** require system `node` on PATH.

### Android

```bash
npm run build:android
cd android && ./gradlew assembleDebug   # Windows: gradlew.bat assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Configure LAN tier34 URL on device (no bundled tier34 in APK).

## Key decisions

| ADR | Decision |
|-----|----------|
| [001-locker-never-auto-delete](./adr/001-locker-never-auto-delete.md) | Locker metadata never silently deleted |
| [002-native-filesdir-not-cache](./adr/002-native-filesdir-not-cache.md) | Android locker audio in `filesDir`, not cache |
| [003-bundled-tier34-tauri-desktop](./adr/003-bundled-tier34-tauri-desktop.md) | Tauri release bundles tier34 sidecar |
| [004-exoplayer-native-android-path](./adr/004-exoplayer-native-android-path.md) | Android default decode via native ExoPlayer |

## Documentation index

| Topic | Location |
|-------|----------|
| Audit artifacts (Pass 1–3) | [docs/audit/](./docs/audit/) |
| Executive summary | [docs/executive-summary.md](./docs/executive-summary.md) |
| Risk register | [docs/risk-register.md](./docs/risk-register.md) |
| Repository health | [docs/repository-health.md](./docs/repository-health.md) |
| Sandbox Server operator guide | [TIER34.md](./TIER34.md) |
| Architecture (with drift warnings) | [docs/sandbox-architecture.md](./docs/sandbox-architecture.md) |
| Codebase metrics **[Snapshot: 2026-07-09]** | [CODEBASE_HEALTH.md](./CODEBASE_HEALTH.md) |

## Known limitations

From [docs/audit/unknowns.md](./docs/audit/unknowns.md) and Pass 3:

- Tauri desktop native queue priming parity with Android Exo is **unverified**.
- Remote track tombstones: code does not delete local rows on sync pull; product docs disagree on intended semantics.
- Bundled tier34 storage path on end-user machines vs dev tree is **medium confidence** only.
- `scripts/spread-host.mjs` unified deploy orchestrator **does not exist** in the repository.
- Linux/macOS packaged anchor depends on system Node without in-repo portable bundle.
- Play Store publish automation from this repo is **unknown** (listing text only in `fastlane/`).
- Air-gap mode does not block all client-direct catalog/archive calls (`sandboxLayer2`).

See [docs/risk-register.md](./docs/risk-register.md) for prioritized risks.

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE) — Copyright (C) 2026 Sandbox Music contributors.

See also [CHANGELOG.md](./CHANGELOG.md) and [CODEBASE_HEALTH.md](./CODEBASE_HEALTH.md).
