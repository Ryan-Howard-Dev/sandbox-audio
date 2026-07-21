# Executive Summary

Synthesized from Pass 1–3 audit artifacts and `CODEBASE_HEALTH.md`. **Audit synthesis date: 2026-07-21.** All claims trace to audit evidence with stated confidence.

---

## Purpose

**Sandbox Music** (`sovereign-music-console`) is a self-hosted music and podcast player with a local locker (IndexedDB vault), catalog metadata exploration, and optional Sandbox Server (tier34) backend for acquire, sync, Connect, and extended search. It ships as web/PWA, Tauri desktop (Windows + Linux), and Android (Capacitor). Phones act as clients to a home-network tier34 instance; desktop anchor mode can auto-start a bundled tier34 sidecar.

---

## Primary technology stack

From `dependencies.md` (Pass 1, High confidence):

| Layer | Technologies |
|-------|----------------|
| Client UI | React 19, Vite 6, Tailwind CSS 4, TypeScript 5.8 |
| UI server | Express on port **3002** (`server.ts`) — catalog proxy, metadata, Gemini playlist curation |
| Sandbox Server | Node/Express + WebSocket on port **3001** (`tier34-server/`) |
| Desktop | Tauri 2, symphonia/cpal/wasapi native audio |
| Android | Capacitor 8, Media3 ExoPlayer, Google Cast, yt-dlp-android |
| Optional services | Meilisearch, Docker compose, Demucs, slskd (Soulseek profile) |
| Testing | Vitest (124 files / 544 tests per `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]**) |

---

## Architecture style

Three-layer client model (`docs/sandbox-architecture.md`, validated by Pass 2):

| Layer | Module | Responsibility |
|-------|--------|----------------|
| Layer 1 | `sandboxLayer1.ts` | Audio FSM, native Exo poll, profiles |
| Layer 2 | `sandboxLayer2.ts` | Provider fleet, metadata, tier resolution orchestration |
| Layer 3 | `sandboxLayer3.tsx` | Shell UI, stations, player, Connect, onboarding |

**Sandbox Server** (tier34, port 3001) is the network hub for acquire, locker blob sync, Meilisearch proxy, Feed, Connect WebSocket, DLNA, and debrid resolve. **UI server** (port 3002) serves the React app and lightweight metadata proxies — not a substitute for tier34.

Pass 3 notes documentation drift: packaged Tauri **does** bundle `tier34-server.mjs` (contrary to older `sandbox-architecture.md` sections). See [adr/003-bundled-tier34-tauri-desktop.md](../adr/003-bundled-tier34-tauri-desktop.md).

Connection modes OFF / REMOTE / ANCHOR (`sandbox_server_mode`) sync to `sandbox_tier34_backend_url` for actual HTTP traffic.

---

## Most mature subsystems (Pass 2 — High confidence)

| Subsystem | Strength signal |
|-----------|-----------------|
| **Provider / tier resolve** | Clear hybrid order (locker → cache → tier34 → mobile → preview); catalog identity guards; extensive `searchProviders.ts` adapters |
| **Playback queue policy** | Extracted `src/play/*` modules with unit tests; explicit advance invariants, gapless suppress, album seeding |
| **Audio pipeline (Android Exo)** | Deliberate OEM mitigations: prefetch ahead, screen-lock keepalive, wired DAC mode, truncated-stream detection |
| **Locker delete guards** | `LOCKER_NEVER_AUTO_DELETE`, user-confirmed deletes, hollow-row model |
| **Deployment CI** | Multi-platform GitHub Actions (web, Tauri Linux/Windows, Android); F-Droid parity script; PWA size gate |
| **Launcher (desktop)** | Single Rust owner for child PID; health-gated readiness; esbuild tier34 bundle in Tauri resources |

---

## Least mature subsystems (Low / Unknown confidence)

| Subsystem | Gap |
|-----------|-----|
| **Unified deploy orchestrator** | `scripts/spread-host.mjs` absent; fragmented npm/CI/Docker paths (`deployment-analysis.md`) |
| **Tauri queue / gapless parity** | No evidenced `primeLockerNativeQueue` equivalent on desktop (`unknowns.md`, `audio-analysis.md` Low) |
| **Soulseek/slskd under load** | Route handlers present; worker backpressure not traced (`provider-analysis.md` Unknown) |
| **Play Store automation** | Fastlane listing text only; no `Fastfile` (`deployment-analysis.md` Unknown) |
| **Air-gap completeness** | `sandboxLayer2.searchArchive` / `searchCatalogProvider` bypass air-gap gate (`provider-analysis.md`) |
| **Tauri infrastructure scaffold** | `src-tauri/src/infrastructure/` — types/registry only per `sandbox-architecture.md` |

---

## Largest technical debt

1. **`sandboxLayer3.tsx` god-object** — ~8k–9.5k lines centralizing queue, playback, launcher auto-start, locker delete, prefetch, Connect, and E2E (`architecture-violations.md`, `CODEBASE_HEALTH.md`).
2. **Dual queue authority on Android** — JS `playQueue` vs Exo `MediaItem` list reconciled by URL matching (`playback-queue-analysis.md`, `architecture-violations.md`).
3. **Multi-store locker drift** — IndexedDB, native files, integrity manifest, sync manifest without single source of truth (`library-analysis.md`, `architecture-violations.md`).
4. **Documentation drift** — 7 Confirmed doc-vs-code mismatches on packaged tier34 and air-gap (`documentation-drift.md`).
5. **Stale health snapshot** — 13 TypeScript errors and 3 failing Vitest tests **[Snapshot: 2026-07-09]** (`CODEBASE_HEALTH.md`).

---

## Biggest engineering strength

**Breadth of deliberate playback hardening for real Android devices** — extracted queue advance policies with tests, native Exo gapless with JS suppress/reconcile, locker durability guards (`LOCKER_NEVER_AUTO_DELETE`), and tier-ordered hybrid resolve with catalog identity checks. The codebase reflects production pain from OEM WebView throttling and cache eviction, addressed with explicit invariants rather than implicit assumptions.

---

## Top 5 improvements (from risk register)

| Priority | Risk ID | Improvement |
|----------|---------|-------------|
| 1 | R-001 | Enforce catalog identity matching on mobile resolve paths |
| 2 | R-003 | Strengthen Exo↔JS queue reconciliation (stable track keys, not URL-only) |
| 3 | R-005 | Surface tier34 spawn failures (stderr/exit code) beyond health timeout |
| 4 | R-007 | Bundle or require system Node on Linux/macOS desktop packages |
| 5 | R-009 | Gate `sandboxLayer2` direct archive/iTunes calls with air-gap policy |

Full register: [risk-register.md](./risk-register.md).

---

## Overall maturity verdict

Sandbox Music is a **feature-rich beta** with strong subsystem-specific engineering (Android playback, locker durability, tier resolve) undermined by **shell concentration** (`sandboxLayer3`), **cross-platform packaging gaps** (Node bundling, deploy fragmentation), and **documented invariant conflicts** (dual queues, air-gap bypass, tombstone semantics) that should be resolved before positioning as a daily-driver self-hosted platform.

---

## Document index

| Document | Purpose |
|----------|---------|
| [docs/audit/](./audit/) | Pass 1–3 audit artifacts |
| [risk-register.md](./risk-register.md) | Prioritized engineering risks |
| [repository-health.md](./repository-health.md) | LOC, tests, CI, dead paths |
| [adr/](../adr/) | Architecture decision records |
| [CODEBASE_HEALTH.md](../CODEBASE_HEALTH.md) | Metrics snapshot **[2026-07-09]** |
