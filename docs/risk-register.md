# Risk Register

Synthesized from Pass 2 Engineering Assessments and Pass 3 architecture violations. **Audit date: 2026-07-21.** Every row traces to audit artifacts only.

**Likelihood / Impact scale:** Low · Medium · High

| Risk ID | Risk | Affected subsystems | Likelihood | Impact | Evidence | Mitigation |
|---------|------|---------------------|------------|--------|----------|------------|
| R-001 | **Wrong-track playback** — parallel tier racing and mobile resolve bypass catalog identity checks (`resolvedStreamMatchesCatalog`) | Provider, Playback | High | High | `provider-analysis.md` Top risk #1; `provider-invariants.md` catalog-track invariant; `architecture-violations.md` (`resolutionSource === 'mobile'` bypass) | Apply catalog match to mobile resolve; cancel or deprioritize lower tiers when higher tier in-flight (`provider-invariants.md` `raceTierHits` row) |
| R-002 | **Debrid/Prowlarr credentials sent browser → tier34 POST** — keys in JSON bodies require trusting Sandbox Server transport | Provider, Security | Medium | High | `provider-invariants.md` Prowlarr/RD credentials row; `provider-analysis.md` Weakness §4 | HTTPS-only tier34; LAN-only exposure; optional `TIER34_DEVICE_SYNC_SECRET`; document trust boundary in operator docs |
| R-003 | **JS queue vs Exo `MediaItem` desync** — dual queue authority; index reconciliation via URL matching | Playback & Queue, Audio | High | High | `playback-queue-analysis.md` Interpretation §2; `playback-queue-invariants.md` `findQueueIndexForExoUrl`; `architecture-violations.md` dual queue authority; `audio-analysis.md` Verified Fact §6 | Stable track keys in native transition events; strengthen `exoQueueSync.ts`; single advance owner per platform path |
| R-004 | **JS `subscribeEnded` vs native gapless auto-advance race** — double-advance or stale index when suppress window fails | Playback & Queue, Audio | Medium | High | `architecture-violations.md`; `playback-queue-invariants.md` suppress window; `audio-analysis.md` JS FSM vs native desync risk | Expand native→JS transition payload beyond URL; extend `shouldSuppressJsAdvanceAfterNativeGapless` coverage |
| R-005 | **Silent tier34 failures** — spawned child stdio nulled; operators see health timeout only | Launcher | High | High | `launcher-analysis.md` Verified Fact §7; Top risk #1; `launcher-invariants.md` readiness row | Surface spawn stderr to Settings/Diagnostics; log tail or exit-code probe; document health-check troubleshooting |
| R-006 | **Port 3001 contention** — Tauri launcher does not `kill-port`; external/manual tier34 blocks anchor start | Launcher | Medium | High | `launcher-analysis.md` Top risk #2; `launcher-invariants.md` dev vs Tauri kill-port row | Pre-start port check; detect external tier34 and adopt URL; align dev and packaged behavior |
| R-007 | **Linux/macOS packaged desktop lacks bundled Node** — `fetch-portable-node.mjs` is Windows-only | Launcher, Deployment | High | High | `launcher-analysis.md` Verified Fact §4; Top risk #3; `deployment-analysis.md` Top risk #3; `deployment-invariants.md` portable Node row | Bundle portable Node for Linux/macOS or document system Node prerequisite; fail fast when `node` missing |
| R-008 | **Multi-store locker drift** — IDB, native files, integrity manifest, `nativeSourcePath` can disagree | Library | High | High | `library-analysis.md` Risks (multi-store drift); `architecture-violations.md` three parallel manifest models | Document canonical ownership per concern; reconciliation pass before heal; continue `lockerDurability` boot verify |
| R-009 | **Air-gap bypass for catalog/archive** — `searchArchive` / `searchCatalogProvider` in `sandboxLayer2` skip `isAirGapEnabled()` | Provider | Medium | High | `provider-analysis.md` Weakness §5; `provider-invariants.md` air-gap row; `architecture-violations.md`; `documentation-drift.md` air-gap rows | Gate Layer 2 direct providers with `isAirGapEnabled()` or air-gap-aware fetch wrapper |
| R-010 | **Remote tombstones never delete local rows on pull** — `applyTrackTombstonesFromManifest` is a no-op | Library, Sync | High | Medium | `library-analysis.md` Verified Fact §8; `library-invariants.md` tombstone row; `architecture-violations.md`; `documentation-drift.md` LOCKER_SYNC row | Align `LOCKER_SYNC.md` with code or implement opt-in tombstone apply behind user confirmation |
| R-011 | **`sandboxLayer3.tsx` god-object** — queue, playback, launcher, locker delete, prefetch, Connect, E2E in one module | Playback, Launcher, Library, Shell | High | High | `architecture-violations.md`; `playback-queue-analysis.md` ~9.5k lines; `CODEBASE_HEALTH.md` split plan | Incremental `src/play/` and `src/shell/*` extraction per `CODEBASE_HEALTH.md` (do not big-bang) |
| R-012 | **`lockerStorage.ts` god-module** — ~5000 lines combining IDB, heal, sync, native bridge | Library | Medium | Medium | `architecture-violations.md`; `library-analysis.md` Risks | Split persistence vs heal vs native-bridge without changing public API in one pass |
| R-013 | **Docker vs desktop tier34 artifact divergence** — container uses `npx tsx` source; Tauri bundles `tier34-server.mjs` | Deployment, Launcher | Medium | Medium | `architecture-violations.md`; `deployment-analysis.md` Verified Fact §6; `launcher-analysis.md` Verified Fact §9 | Document two supported shapes; optional CI smoke for both paths |
| R-014 | **`npm start` is UI-only** — no tier34/Meilisearch in production web start path | Deployment | High | Medium | `deployment-analysis.md` Verified Fact §3; `deployment-invariants.md` | Operator docs: Docker or separate tier34 for full stack; do not assume `npm start` is full-stack |
| R-015 | **Absent `spread-host.mjs` deploy orchestrator** — fragmented npm, CI, Docker steps | Deployment | High | Medium | `deployment-analysis.md` Verified Fact §1; `deployment-invariants.md` | Single operator runbook; optional future unified deploy script |
| R-016 | **Stale tier34 reachability cache** — proxy URL attachment after server loss | Provider, Audio | Medium | High | `provider-invariants.md` full-stream playback row; `audio-invariants.md` offline cached URLs row | Shorten health cache TTL; re-check before attach |
| R-017 | **Hardcoded Invidious/Piped instances** — tier-3 upstream fragility | Provider | High | Medium | `provider-analysis.md` Weakness §3; Top risk #3 | Health rotation or configurable instance list |
| R-018 | **Fast boot optimistic `offlineReady`** — UI may show playable rows that fail at Exo gate | Library, Audio | Medium | Medium | `library-analysis.md` Verified Fact §6; `library-invariants.md` `offlineReady` row | Run `refreshLockerPlayabilityFull` after boot gate; gate play tap on full probe when needed |
| R-019 | **Documentation drift on packaged tier34** — `sandbox-architecture.md` claims tier34 not embedded | Deployment, Launcher | High | Low | `documentation-drift.md` (7 Confirmed rows); `launcher-analysis.md` counter_evidence | Update operator docs to match `tauri.conf.json` `beforeBuildCommand` + bundle resources |
| R-020 | **Phone E2E not release-gated** — scripts exist; not enforced on every release build | Deployment, QA | Medium | Medium | `CODEBASE_HEALTH.md` Phone E2E gate row; `deployment-analysis.md` (phone-e2e-gate.yml referenced, not blocking publish) | Add E2E to release `publish.needs` or documented release checklist |

---

## Summary

| Severity (Impact High) | Count |
|------------------------|------:|
| High-impact risks documented | 12 |
| Required high risks (Pass 4 brief) | 9 |
| Additional synthesized risks | 11 |

---

## Evidence index

Pass 2: `provider-analysis.md`, `provider-invariants.md`, `playback-queue-analysis.md`, `playback-queue-invariants.md`, `audio-analysis.md`, `audio-invariants.md`, `launcher-analysis.md`, `launcher-invariants.md`, `library-analysis.md`, `library-invariants.md`, `deployment-analysis.md`, `deployment-invariants.md`

Pass 3: `architecture-violations.md`, `documentation-drift.md`, `unknowns.md`

Snapshot: `CODEBASE_HEALTH.md` (2026-07-09)
