# Pass 1 — Documentation Manifest

Master table of contents for all project documentation in `sovereign-music-console`. **Inventory date: 2026-07-21** (Pass 1 catalog; Pass 2 subsystem code audits). Content accuracy of individual docs was not verified in Pass 1.

**Legend — Confidence:** High = read or heading-verified this pass; Medium = path/purpose inferred from filename and cross-refs; Low = not opened.

**Legend — Last Audited:** `2026-07-21` = created or inventoried this pass; `—` = exists but content not reviewed.

---

## Audit artifacts (Pass 1)

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [documentation-manifest.md](./documentation-manifest.md) | Master doc index (this file) | Pass 1 repo scan | 2026-07-21 | High | search-scope.md |
| [dependencies.md](./dependencies.md) | Internal module and external package inventory | package.json, Cargo.toml, Gradle, import grep | 2026-07-21 | High | — |
| [search-scope.md](./search-scope.md) | Defines Pass 1 scan boundaries and exclusions | Pass 1 methodology | 2026-07-21 | High | — |
| [repository-map.md](./repository-map.md) | Top-level directory stability classification | Directory listing | 2026-07-21 | High | — |

---

## Audit artifacts (Pass 2)

Subsystem code audits (analysis + invariants per area). **Audit date: 2026-07-21.**

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [playback-queue-analysis.md](./playback-queue-analysis.md) | Playback & queue subsystem: inputs/outputs, advance policy, Exo sync, persistence | `sandboxLayer3.tsx`, `sandboxLayer1.ts`, `src/play/*`, `trackPrefetch.ts` | 2026-07-21 | High | playback-queue-invariants.md, dependencies.md |
| [playback-queue-invariants.md](./playback-queue-invariants.md) | Playback & queue invariants with evidence and violation risk | `queueAdvancePolicy`, `albumPlayQueue`, `sandboxLayer3` ended/skip paths | 2026-07-21 | High | playback-queue-analysis.md |
| [launcher-analysis.md](./launcher-analysis.md) | Node.js station launcher & daemon: Tauri child process, bridge, health gate, packaging | `src-tauri/src/local_server.rs`, `sandboxServerBridge.ts`, `Dockerfile.tier34` | 2026-07-21 | High | launcher-invariants.md, TIER34.md |
| [launcher-invariants.md](./launcher-invariants.md) | Launcher/daemon invariants: spawn, stop, health-gate, packaged Node | `local_server.rs`, `sandboxServerBridge.ts`, `package.json` scripts | 2026-07-21 | High | launcher-analysis.md |
| [deployment-analysis.md](./deployment-analysis.md) | Deployment automation: build, package, publish, self-host stack bring-up | `scripts/*.mjs`, `docker-compose.yml`, `.github/workflows/`, `Dockerfile.tier34` | 2026-07-21 | High | deployment-invariants.md, SELF_HOST.md |
| [deployment-invariants.md](./deployment-invariants.md) | Deployment invariants: compose stack, CI release, F-Droid reproducibility | `docker-compose*.yml`, `.github/workflows/release.yml`, `metadata/fdroid/` | 2026-07-21 | High | deployment-analysis.md, launcher-invariants.md |
| [provider-analysis.md](./provider-analysis.md) | Provider system & model routing: tier resolve, addon/manifest search, fidelity policy | `playbackPipeline.ts`, `hybridResolution.ts`, `tier34-server/lib/*Resolve.ts` | 2026-07-21 | High | provider-invariants.md, dependencies.md |
| [provider-invariants.md](./provider-invariants.md) | Provider/routing invariants: tier order, resolver fallbacks, addon constraints | `sandboxLayer2.ts`, `mobileResolverRegistry.ts`, `fidelityPolicy.ts` | 2026-07-21 | High | provider-analysis.md |
| [audio-analysis.md](./audio-analysis.md) | Audio pipeline: decode path, FSM, prefetch, Exo/WebView, DAC, cast stream URLs | `useAudioFSM`, `playbackPipeline`, `trackPrefetch`, native Exo plugins | 2026-07-21 | High | audio-invariants.md, playback-queue-analysis.md |
| [audio-invariants.md](./audio-invariants.md) | Audio/decode invariants: FSM transitions, prefetch, native attach, focus/gain | `sandboxLayer1.ts`, `playbackPipeline.ts`, `trackPrefetch.ts` | 2026-07-21 | High | audio-analysis.md, playback-queue-invariants.md |
| [library-analysis.md](./library-analysis.md) | Media library & local storage: locker vault, IndexedDB, sync, native blob store | `lockerStorage.ts`, `LockerVaultContext.tsx`, `tier34-server/lib/lockerStorage.ts` | 2026-07-21 | High | library-invariants.md, LOCKER_SYNC.md |
| [library-invariants.md](./library-invariants.md) | Locker/vault invariants: durability manifest, delete guards, sync, art cache | `lockerDurability.ts`, `lockerDeleteGuard.ts`, `lockerSync.ts` | 2026-07-21 | High | library-analysis.md |

---

## Audit artifacts (Pass 3)

Cross-subsystem validation and documentation drift. **Audit date: 2026-07-21.**

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [architecture-violations.md](./architecture-violations.md) | Pass 2 cross-reference: god objects, dual queues, air-gap gaps, manifest drift | Pass 2 subsystem audits + grep/line counts | 2026-07-21 | High | All Pass 2 *-analysis.md |
| [documentation-drift.md](./documentation-drift.md) | Operator docs vs Pass 2 code: Confirmed/Partial/Verified drift rows | `sandbox-architecture.md`, `offline-capability.md`, `LOCKER_SYNC.md`, Pass 2 launcher/provider/library | 2026-07-21 | High | Pass 2 audits |
| [unknowns.md](./unknowns.md) | Questions not answerable from Pass 1–2 evidence | Pass 2 Unknown/Low confidence items | 2026-07-21 | High | Pass 2 audits |

---

## Audit artifacts (Pass 4)

Documentation synthesis from Pass 1–3 + `CODEBASE_HEALTH.md`. **Synthesis date: 2026-07-21.**

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [../risk-register.md](../risk-register.md) | Prioritized engineering risk register | Pass 2 Engineering Assessment + Pass 3 violations | 2026-07-21 | High | architecture-violations.md, *-analysis.md |
| [../repository-health.md](../repository-health.md) | LOC hotspots, test/CI health, dead paths | CODEBASE_HEALTH.md, repository-map.md, deployment-analysis.md | 2026-07-21 | High | CODEBASE_HEALTH.md |
| [../executive-summary.md](../executive-summary.md) | Executive overview: stack, maturity, top improvements | Pass 1–3 audits, dependencies.md, sandbox-architecture.md | 2026-07-21 | High | risk-register.md |
| [../../adr/001-locker-never-auto-delete.md](../../adr/001-locker-never-auto-delete.md) | ADR: locker never auto-delete | library-invariants.md, library-analysis.md | 2026-07-21 | High | library-analysis.md |
| [../../adr/002-native-filesdir-not-cache.md](../../adr/002-native-filesdir-not-cache.md) | ADR: Android filesDir locker storage | library-analysis.md, LockerBlobRegistry | 2026-07-21 | High | library-analysis.md |
| [../../adr/003-bundled-tier34-tauri-desktop.md](../../adr/003-bundled-tier34-tauri-desktop.md) | ADR: Tauri bundles tier34 sidecar | launcher-analysis.md, deployment-analysis.md | 2026-07-21 | High | launcher-analysis.md |
| [../../adr/004-exoplayer-native-android-path.md](../../adr/004-exoplayer-native-android-path.md) | ADR: Android native ExoPlayer decode | audio-analysis.md, playback-queue-analysis.md | 2026-07-21 | High | audio-analysis.md |
| [../../README.md](../../README.md) | Root onboarding (Pass 4 synthesis) | Pass 2 Verified Facts + executive-summary.md | 2026-07-21 | High | executive-summary.md, adr/ |

---

## Audit artifacts (Pass 5)

Validation and certification. **Audit date: 2026-07-21.**

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [audit-certificate.md](./audit-certificate.md) | Repository audit certificate, confidence rollup, certification liabilities | Pass 1–4 artifacts + systematic `confidence:` grep on Pass 2 analyses | 2026-07-21 | High | All Pass 2 *-analysis.md, unknowns.md, risk-register.md, README.md, adr/ |

---

## Root documentation

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [README.md](../../README.md) | Primary onboarding: platforms, quick start, build targets, ADR index | Pass 4 synthesis from Pass 2 audits | 2026-07-21 | High | executive-summary.md, adr/ |
| [TIER34.md](../../TIER34.md) | Sandbox Server (tier 3/4) operator guide: ports, endpoints, env | Manual | — | High | SELF_HOST.md, tier34-server/ |
| [BUILDING.md](../../BUILDING.md) | Desktop and Android build steps | Manual | — | Medium | README.md |
| [SELF_HOST.md](../../SELF_HOST.md) | Docker compose self-host quick start (tier34 + Meilisearch) | Manual | — | Medium | docker-compose.yml, TIER34.md |
| [ADDONS.md](../../ADDONS.md) | Addon manifest testing workflow; experimental vs user addons | Manual | — | High | README.md, TIER34.md, src/addonStorage.ts |
| [LOCKER_SYNC.md](../../LOCKER_SYNC.md) | Cross-device locker sync scope, phases, architecture | Manual | — | Medium | TIER34.md, tier34-server/lib/lockerStorage.ts |
| [CHANGELOG.md](../../CHANGELOG.md) | Release history (Keep a Changelog format) | Manual | — | Medium | — |
| [CODEBASE_HEALTH.md](../../CODEBASE_HEALTH.md) | Line counts, test health, god-file split plan | Manual snapshot (2026-07-09) | — | High | src/sandboxLayer3.tsx |
| [STATUS.md](../../STATUS.md) | **Deprecated** session log; redirects to CHANGELOG, CODEBASE_HEALTH, CHRONICLE | Manual | — | High | CHANGELOG.md, docs/CHRONICLE.md |
| [LICENSE](../../LICENSE) | GNU GPL v3.0 license text | Manual | — | Medium | — |

---

## docs/ — topic guides

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [docs/sandbox-architecture.md](../sandbox-architecture.md) | High-level Sandbox Music architecture | Manual | — | Medium | README.md |
| [docs/sandbox-indexer.md](../sandbox-indexer.md) | Sandbox Indexer (Meilisearch locker indexing) | Manual | — | Medium | tier34-server/lib/meilisearchIndexer.ts |
| [docs/INFRASTRUCTURE.md](../INFRASTRUCTURE.md) | Infrastructure overview (hosting, services) | Manual | — | Medium | SELF_HOST.md |
| [docs/CHRONICLE.md](../CHRONICLE.md) | Long-form design history and session index | Manual | — | Medium | CODEBASE_HEALTH.md |
| [docs/offline-capability.md](../offline-capability.md) | Offline playback and locker capability audit | Manual | — | Medium | README.md |
| [docs/testing-checklist.md](../testing-checklist.md) | Multi-platform manual testing checklist | Manual | — | Medium | — |
| [docs/tier34-validation.md](../tier34-validation.md) | Tier34 validation suite usage | Manual | — | Medium | src/tier34ValidationSuite.ts, TIER34.md |
| [docs/desktop-setup.md](../desktop-setup.md) | Desktop installer vs first-launch setup | Manual | — | Medium | BUILDING.md, src-tauri/ |
| [docs/beets-integration.md](../beets-integration.md) | Beets → Sandbox Locker folder watch sync | Manual | — | Medium | scripts/beets-watch-sync.mjs |
| [docs/scrobbling.md](../scrobbling.md) | Last.fm scrobbling via tier34 relay | Manual | — | Medium | src/scrobble.ts |
| [docs/federated-taste.md](../federated-taste.md) | Federated taste profiles and signing | Manual | — | Medium | src/tasteManifest.ts |
| [docs/opensubsonic.md](../opensubsonic.md) | OpenSubsonic API on tier34 | Manual | — | Medium | tier34-server/routes/subsonic.ts |
| [docs/dlna-mediaserver.md](../dlna-mediaserver.md) | DLNA/UPnP MediaServer on tier34 | Manual | — | Medium | tier34-server/lib/dlnaMediaServer.ts |
| [docs/interminable-tide.md](../interminable-tide.md) | Interminable Tide defense/rate-limit feature | Manual | — | Low | tier34-server/lib/interminableTide.ts |
| [docs/http3-quic.md](../http3-quic.md) | HTTP/3 QUIC gateway via Caddy overlay | Manual | — | Medium | docker-compose.overlay.yml, overlay/ |
| [docs/overlay-network.md](../overlay-network.md) | Headscale/Tailscale overlay for remote tier34 access | Manual | — | Medium | overlay/, docker-compose.overlay.yml |
| [docs/air-gap-lan-party.md](../air-gap-lan-party.md) | Air-gap LAN party mode | Manual | — | Low | src/airGapMode.ts |
| [docs/vinyl-widget-embed.md](../vinyl-widget-embed.md) | OBS/dashboard vinyl now-playing widget embed | Manual | — | Medium | src/vinylWidget.ts |
| [docs/android-playback.md](../android-playback.md) | Android background playback | Manual | — | Medium | android/, src/backgroundMedia.ts |
| [docs/android-wake-alarm.md](../android-wake-alarm.md) | Android wake alarm feature | Manual | — | Medium | src/nativeWakeAlarm.ts |
| [docs/android-auto.md](../android-auto.md) | Android Auto browse/play (Phase 2) | Manual | — | Medium | src/androidAuto.ts |
| [docs/android-remote-cast.md](../android-remote-cast.md) | Sandbox Cast on Android | Manual | — | Medium | src/castPlatform.ts |
| [docs/android-tv-readiness.md](../android-tv-readiness.md) | Android TV readiness report | Manual | — | Medium | src/tvDetection.ts |
| [docs/android-release.md](../android-release.md) | Signed Android release via GitHub Actions | Manual | — | Medium | .github/workflows/release.yml |
| [docs/fdroid.md](../fdroid.md) | F-Droid reproducible build (repo-local) | Manual | — | Medium | metadata/fdroid/ |
| [docs/fdroid-submit.md](../fdroid-submit.md) | F-Droid submission guide for maintainers | Manual | — | Medium | metadata/fdroid/README.md |
| [docs/linux-tcp-bbr.md](../linux-tcp-bbr.md) | Linux TCP BBR tuning for tier34 hosts | Manual | — | Low | — |
| [docs/linux-network-bonding.md](../linux-network-bonding.md) | Linux network bonding (LAN + tether) | Manual | — | Low | scripts/linux-network-bonding.sh |

---

## Scripts, metadata, and addon docs

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [scripts/INSTALL-RULES.md](../../scripts/INSTALL-RULES.md) | Agent/script rules for physical Android device installs | Manual | — | High | scripts/android-*.ps1 |
| [metadata/fdroid/README.md](../../metadata/fdroid/README.md) | F-Droid submission template and signing model | Manual | — | Medium | docs/fdroid.md |
| [public/addons/record-player/README.md](../../public/addons/record-player/README.md) | Community vinyl visual pack catalog publishing | Manual | — | Medium | public/addons/record-player/manifest.json |

---

## Tooling and workspace rules

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [.cursor/rules/no-unsolicited-ui.mdc](../../.cursor/rules/no-unsolicited-ui.mdc) | Cursor agent rule: no unsolicited UI changes | Manual | — | High | — |

---

## Config-embedded documentation (comments)

These are not standalone markdown files but carry operator-facing documentation in comments.

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [package.json](../../package.json) (`scripts`) | npm script catalog (dev, build, android, fdroid, tauri) | Manual | — | High | scripts/* |
| [capacitor.config.ts](../../capacitor.config.ts) | Capacitor app ID, plugin options, navigation/cleartext policy | Manual | — | High | android/ |
| [vite.config.ts](../../vite.config.ts) | E2E bridge gate, PWA manifest metadata, chunk split notes | Manual | — | Medium | — |
| [docker-compose.yml](../../docker-compose.yml) | Service roles: meilisearch, tier34, slskd profile | Manual | — | High | SELF_HOST.md |
| [docker-compose.overlay.yml](../../docker-compose.overlay.yml) | Overlay stack (Headscale, Caddy HTTP/3) | Manual | — | Medium | docs/overlay-network.md |
| [docker-compose.soulseek.yml](../../docker-compose.soulseek.yml) | Soulseek slskd compose adjunct | Manual | — | Medium | config/slskd.docker.yml |
| [Dockerfile.tier34](../../Dockerfile.tier34) | tier34 container build (Node 22, tsx entry) | Manual | — | High | tier34-server/ |
| [tsconfig.json](../../tsconfig.json) | `@/*` path alias, src-tauri target exclude | Manual | — | Medium | — |
| [android/variables.gradle](../../android/variables.gradle) | Android SDK and androidx version pins | Manual | — | High | android/app/build.gradle |
| [android/app/build.gradle](../../android/app/build.gradle) | ABI splits, signing, native deps comments | Manual | — | High | BUILDING.md |
| [tier34-server/index.ts](../../tier34-server/index.ts) (header) | Sandbox Server module identity and default port | Manual | — | High | TIER34.md |

---

## Fastlane store listing (plain text, not markdown)

| Document | Purpose | Generated From | Last Audited | Confidence | Depends On |
|----------|---------|----------------|--------------|------------|------------|
| [fastlane/metadata/android/en-US/full_description.txt](../../fastlane/metadata/android/en-US/full_description.txt) | Play Store long description | Manual | — | Low | README.md |
| [fastlane/metadata/android/en-US/short_description.txt](../../fastlane/metadata/android/en-US/short_description.txt) | Play Store short description | Manual | — | Low | — |

---

## Excluded from inventory (not canonical docs)

| Path pattern | Reason |
|--------------|--------|
| `node_modules/**` | Third-party package documentation |
| `dist/**`, `android/app/build/**`, `src-tauri/target/**` | Build output; may contain copied README |
| `android/app/src/main/assets/public/**` | Capacitor-synced web build |
| `proof-screenshots/**`, `proof-oneplus-46349770/**` | QA artifacts (screenshots, logcat) |
| `_apk_check/**`, `_readonly_locker_check/**` | Investigation scratch outputs |

---

## Document count summary

| Category | Count |
|----------|------:|
| Audit artifacts (Pass 1) | 4 |
| Audit artifacts (Pass 2) | 12 |
| Audit artifacts (Pass 3) | 3 |
| Audit artifacts (Pass 4) | 8 |
| Audit artifacts (Pass 5) | 1 |
| ADRs (`adr/`) | 4 |
| Root markdown + LICENSE | 10 |
| docs/*.md | 28 |
| Scripts / metadata / public addon README | 3 |
| Cursor rules (.mdc) | 1 |
| Config-embedded (comment docs) | 11 |
| Fastlane text listings | 2 |
| **Total inventoried** | **87** |

---

## Suggested reading order (for new contributors)

1. README.md → [executive-summary.md](../executive-summary.md) → sandbox-architecture.md → TIER34.md
2. BUILDING.md or SELF_HOST.md (by target platform)
3. CODEBASE_HEALTH.md → [repository-health.md](../repository-health.md) → dependencies.md (this audit)
4. [risk-register.md](../risk-register.md) and [adr/](../../adr/) for engineering decisions
5. Topic docs as needed (android-*, opensubsonic, locker sync, etc.)
