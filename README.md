<div align="center">

<img src="./public/icon-desktop.svg" width="104" alt="Sandbox Audio">

# Sandbox Audio

**Music, podcasts and audiobooks — on hardware you own.**

[![License](https://img.shields.io/badge/License-GPL--3.0-C2410C?style=for-the-badge&labelColor=07080c)](./LICENSE)
[![Local first](https://img.shields.io/badge/Local–first-your%20library%2C%20your%20hardware-C2410C?style=for-the-badge&labelColor=07080c)](#why-this-exists)
[![Telemetry](https://img.shields.io/badge/Telemetry-none-6E758C?style=for-the-badge&labelColor=07080c)](#why-this-exists)

[![Platforms](https://img.shields.io/badge/Web·PWA-1C1C1E?style=flat-square&labelColor=07080c)](./BUILDING.md)
[![Desktop](https://img.shields.io/badge/Tauri%20desktop-Windows%20·%20Linux-1C1C1E?style=flat-square&labelColor=07080c)](./BUILDING.md)
[![Android](https://img.shields.io/badge/Android-phone%20·%20TV-1C1C1E?style=flat-square&labelColor=07080c)](./BUILDING.md)

</div>

---

**Sandbox Audio** is a self-hosted player built on three pillars — **music**, **podcasts** and
**audiobooks** — which share one playback engine, one queue and one library. It runs as a **web
application**, as **desktop software** for Windows and Linux, and on **Android**, including Android
TV, and it continues to work when the network does not.

The audiobooks pillar is the broadest of the three, and covers reading as well as listening. It
handles spoken-word recordings, your ebook collection and your own documents, and it will narrate
any of them aloud: EPUB, PDF, DOCX, HTML, Markdown and plain text are extracted and spoken through
the device's own speech engine, so a book or a paper you hold only as a file becomes something you
can listen to on a commute. It reads the chapter marks embedded in M4B files, groups recordings
split across many files back into single books, imports a Calibre library from its folder tree
without touching its database, and recognises series so the next volume is offered when you finish
one. Public-domain catalogues — LibriVox, Project Gutenberg, the Internet Archive — are searchable
from inside it.

That combination is the unusual part. Players that handle music and podcasts well are common;
players that treat audiobooks as a first-class format are rarer; players that will also read your
own documents aloud, from one library, on your own hardware, with a server you run yourself, are
rarer still.

> **Beta software.** Expect rough edges in playback, mobile layout and search. It is not
> recommended as a daily driver without backups of your library.

## Why this exists

Streaming taught a generation to treat a library as something rented. When a subscription lapses
the shelf empties, and when a licence expires a recording disappears from a collection its owner
believed was theirs. The same arrangement has now reached podcasts and audiobooks, media that until
recently arrived as a file you kept. Behind it sits a second cost that is rarely stated: the
service is paid for by what it learns about the person using it, and a listening history is an
unusually revealing thing to surrender.

Sandbox Audio is built on the opposite assumption.

- **Your library is a set of files you hold.** They are stored on your own device, in ordinary
  formats, and nothing about them depends on this software continuing to exist. Leaving costs you
  nothing.
- **Your identity belongs to you.** An account is supported and is used across the Sandbox
  applications, so that settings, library and listening history follow you between devices. It is
  held on your own hardware and shared with nobody. There is no account on a server belonging to
  the author, because there is no such server.
- **Nothing is collected.** There is no analytics, no crash reporting and no telemetry of any kind.
  Nothing is gathered because nothing is sent.
- **Working offline is the ordinary case, not a mode.** Playback is resolved from the local library
  first, and an absent connection changes nothing about it.
- **The licence protects you, not the author.** GPL-3.0 means the software you have come to depend
  upon cannot later be closed against you.

## Part of Sandbox

Sandbox Audio is one of three applications sharing a household server and a common principle —
that the software you rely on should run on hardware you control.

| Project | What it is | Status |
|---------|-----------|--------|
| **Sandbox OS** | A Debian-based operating system built around *stations* rather than a desktop of separate programs. | In development |
| **Sandbox Audio** | This repository. Music, podcasts, and an audiobooks pillar that also reads your ebooks and documents aloud. | Beta, builds on device |
| **Sandbox Builder** | The stations UI and compile toolchain (Conduit), with its own UI server and optional desktop shell. Application source is private; [operator docs are public](https://ryan-howard-dev.github.io/sandbox-builder-docs/). | In development |

### The Sandbox Server

The **Sandbox Server** (`tier34`) is a small server you run yourself, on a spare machine, a home
server or a single-board computer. It is optional: with no server at all each application works
entirely on its own, and only transfer between devices is lost. It performs three jobs.

- **It keeps your library consistent across your devices.** Files added on one device become
  available on the others, transferred directly between machines on your own network. Nothing is
  uploaded to an outside service along the way.
- **It searches your collection**, so a large library stays usable from a phone without that phone
  holding an index of everything in it.
- **It allows one device to take over from another.** A recording begun on a phone can be resumed
  on a desktop or a television at the point it had reached.

It is documented in [TIER34.md](./TIER34.md), and every capability it does and does not yet have is
recorded in [the capability matrix](https://github.com/Ryan-Howard-Dev/sandbox-os/blob/main/docs/TIER34-FOUNDER-BRIEF.md).
Today it ships inside this repository. Extracting it into a package of its own is planned but
**not started**: the trigger is a second application depending on it, and only Audio does today.

## In development — the media diary

A single record of everything you have listened to and read, held across all three pillars and the
ebooks alongside them, rather than four separate histories that never meet.

- **One event log.** Every play is recorded once, appended and never rewritten, whether it came
  from a track, an episode or a chapter. The same record answers "what did I finish last month"
  across every kind of media at once.
- **One shelf model.** Each work carries a state — intended, started, finished, abandoned, being
  revisited — so a part-read book and a part-heard series behave the same way.
- **Lists you arrange yourself**, for the backlog you mean to get to rather than the queue you are
  playing now.
- **An Insights station**, drawing on that record to show how listening actually falls across the
  week and across formats.
- **Synchronisation between your own devices** through the Sandbox Server, as an option rather than
  a requirement.
- **Export where you ask for it.** Last.fm and ListenBrainz can be mirrored to if you want that;
  neither is required, and in air-gapped mode no event leaves the device at all.

Comparable services keep this history on their own servers, where it is retained and analysed. Here
it stays on your hardware. The design is settled; implementation has not begun.

## Before you run it

**You supply your own credentials.** No third-party API keys ship with this project. Optional
integrations — TIDAL playlist import is the current example — read their credentials from your
build environment (`VITE_TIDAL_CLIENT_ID`, `VITE_TIDAL_CLIENT_SECRET`); see `.env.example`. Leave
them unset and that feature is simply absent. Register your own application with the provider
rather than reusing anyone else's: values compiled into a client are readable by anyone holding the
build, so a shared key is a key that gets rate-limited or banned for everybody.

**Extraction is off unless you turn it on.** The app can resolve audio through yt-dlp–style
extractors, including a native one on Android. It ships **disabled**: `VITE_ACQUISITION_DEFAULT_ON`
is unset in [.env.example](./.env.example), no build enables it, and there is no published release
at all. The resolver is still listed in Settings so you can see what it is before deciding — the
build flag sets the starting position, and your own per-resolver choice overrides it either way
(`src/mobileResolverRegistry.ts`). Turning it on is a deliberate act, twice over.

**You are responsible for what you point it at.** This is a player and a locker. It does not supply
music, and what is lawful to fetch, store or play depends on the source, the content and where you
live — not on this software. That judgement is yours to make, and so are the consequences.

**Licensed under GPL-3.0.** See [LICENSE](./LICENSE).

**Build targets (audit-verified):** Web/PWA, Tauri desktop (Windows + Linux), Android (Capacitor). These builds are configured and run on device — they are **not published releases**. There is no tagged release, no GitHub release artifact, and no F-Droid or Play Store listing; `fastlane/` holds listing text only. Build it yourself per [BUILDING.md](./BUILDING.md). iOS and macOS desktop are not build targets at all.

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
- ~~Linux/macOS packaged anchor depends on system Node without in-repo portable bundle.~~
  **Resolved:** `scripts/fetch-portable-node.mjs` now bundles Node for linux and darwin
  (x64/arm64), closing R-007. The Tauri Linux build passes CI.
- Play Store publish automation from this repo is **unknown** (listing text only in `fastlane/`).
- Air-gap mode does not block all client-direct catalog/archive calls (`sandboxLayer2`).

See [docs/risk-register.md](./docs/risk-register.md) for prioritized risks.

## Credits

Created and directed by **Ryan Howard** — architecture, product decisions, and every call about
what this app is for.

Co-created with AI.

Implementation — these wrote code and appear as `Co-authored-by` trailers on the commits they
contributed to, so that record lives in `git log` rather than only here:

- **Cursor** (`cursoragent@cursor.com`)
- **Claude Code** (`Claude Opus 5`)

Research and architecture exploration — shaped decisions without writing commits, so no
trailers:

- **Google AI Studio** (Gemini)

Research output was treated as input, not instruction. Several proposals were adopted (WAL and
connection-pool design, `lofty`, envelope encryption, plugin sandboxing limits, Kokoro-82M for
local TTS); several were rejected after review (blockchain integration, residential proxy
pools, a Go control plane this project does not have).

## License

This project is licensed under the [GNU General Public License v3.0](./LICENSE) — Copyright (C) 2026 Sandbox Audio contributors.

GPL-3.0 is a deliberate choice, not a default. It means anyone who receives this software receives
the source with it, and any derivative stays open on the same terms. A tool people are asked to
trust with their library should not be closeable against them later.

See also [CHANGELOG.md](./CHANGELOG.md) and [CODEBASE_HEALTH.md](./CODEBASE_HEALTH.md).
