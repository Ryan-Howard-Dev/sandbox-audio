# Pass 3 — Architecture Violations

Cross-reference of Pass 2 subsystem audits against code structure. **Audit date: 2026-07-21.** Only violations with evidence from Pass 2 YAML blocks, invariant tables, or verified grep/line counts are listed.

**Circular dependencies:** No import cycle involving `sandboxLayer1` ↔ `sandboxLayer2` ↔ `sandboxLayer3` was evidenced. `sandboxLayer3` is not imported by any `src/` module (grep). `lockerSync.ts` → `lockerStorage.ts` is one-way.

---

| Violation | Type | Evidence (files + symbols) | Severity | Recommended fix |
|-----------|------|---------------------------|----------|-----------------|
| `sandboxLayer3.tsx` centralizes queue, playback, launcher auto-start, locker delete, prefetch, Connect, cast, E2E, and persistence in one module (~9550 lines) | God object / layering | `docs/audit/playback-queue-analysis.md` (Architectural Interpretation §1); `docs/audit/dependencies.md` (`sandboxLayer3` imports `sandboxLayer1`, `sandboxLayer2`, `play/*`, `stations/*`, `lockerStorage`, `tier34/*`); line count `src/sandboxLayer3.tsx` | **High** | Continue `src/play/` extraction; move launcher hooks (`maybeAutoStartLocalSandboxServer`, `ensureTier34ForPlayback`) behind a thin shell facade; keep policy in `src/play/*` |
| `lockerStorage.ts` (~5076 lines) combines IDB schema, cache, heal, sync hooks, native bridge, and UI-facing mutations | God object | `docs/audit/library-analysis.md` (Risks: "`lockerStorage.ts` surface area ~5000 lines"); `src/lockerStorage.ts` | **Medium** | Split persistence vs heal vs native-bridge modules without changing public API surface in one pass |
| Three parallel manifest models for locker state with no single source of truth | Duplicated abstraction | **IDB:** `SandboxMusicCoreDB` `tracks` + `track_blobs` (`lockerStorage.ts` `initDB`, `DB_VERSION`); **Sync:** `LockerSyncManifest` (`src/lockerSync.ts`, `tier34-server/lib/lockerStorage.ts` `MANIFEST_PATH`); **Integrity:** `locker-integrity-manifest-v1` (`src/lockerDurability.ts` `MANIFEST_KEY`); `docs/audit/library-analysis.md` Verified Facts §9–10 | **High** | Document canonical ownership per concern; avoid writing the same track id to divergent manifests without a reconciliation pass |
| Dual queue authority on Android: JS `playQueue`/`queueIndex` vs native Exo `MediaItem` list | Cross-subsystem invariant conflict (audio ↔ playback-queue) | `docs/audit/playback-queue-analysis.md` (Interpretation §2: "Dual queue authority"); `docs/audit/playback-queue-invariants.md` (`findQueueIndexForExoUrl`, `shouldSuppressJsAdvanceAfterNativeGapless`); `docs/audit/audio-analysis.md` Verified Fact §6 (`onMediaItemTransition`, `enqueueNext`); `src/play/exoQueueSync.ts`, `NativeExoPlaybackPlugin.java` | **High** | Strengthen index reconciliation (stable track keys, not URL-only); emit envelope id in native transition events |
| JS `subscribeEnded` advance vs native gapless auto-advance can race or double-advance | Cross-subsystem invariant conflict (audio ↔ playback-queue) | `docs/audit/playback-queue-invariants.md` (suppress window 4s, `trackPlaybackMatureForAdvance`); `docs/audit/audio-analysis.md` (Risk: "JS FSM vs native audible desync"); `sandboxLayer3.tsx` `subscribeEnded`, `shouldSuppressJsAdvanceAfterNativeGapless` | **High** | Single advance owner per platform path; expand native→JS transition payload beyond URL |
| Air-gap policy gated in `searchProviders.ts` but `sandboxLayer2.searchArchive` / `searchCatalogProvider` call archive.org and iTunes directly without `isAirGapEnabled()` | Layering / policy violation | `docs/audit/provider-invariants.md` (Air-gap invariant row); `docs/audit/provider-analysis.md` Weakness §5; `src/addons/searchProviders.ts` (`isAirGapEnabled` early returns); `src/sandboxLayer2.ts` `searchArchive`, `searchCatalogProvider`, `tieredFanOut` (no air-gap check; grep: no `isAirGapEnabled` in `sandboxLayer2.ts`) | **Medium** | Gate `searchArchive` / `searchCatalogProvider` (and `tieredFanOut` fan-out) with `isAirGapEnabled()` or route through air-gap-aware fetch wrapper |
| `resolutionSource === 'mobile'` bypasses catalog identity checks that tier resolve enforces | Cross-subsystem invariant conflict (provider ↔ playback) | `docs/audit/provider-invariants.md` (catalog-track playback invariant); `docs/audit/provider-analysis.md` Top risk #1; `playbackPipeline.ts` / `hybridResolution.ts` per Pass 2 evidence | **High** | Apply `resolvedStreamMatchesCatalog` (or equivalent) to mobile resolve results before attach |
| Layer 3 shell directly owns tier34 launcher lifecycle (auto-start, playback ensure) instead of launcher subsystem boundary | Layering violation | `docs/audit/launcher-analysis.md` (Called by: `sandboxLayer3.tsx` auto-start, `ensureTier34ForPlayback`); `src/sandboxServerBridge.ts` `maybeAutoStartLocalSandboxServer`, `ensureTier34ForPlayback`; `sandboxLayer3.tsx` `useEffect` | **Medium** | Invoke launcher only from `sandboxServerBridge` + Settings; shell registers callbacks, does not embed spawn policy |
| Remote track tombstones recorded and exported but `applyTrackTombstonesFromManifest` is a no-op on pull — conflicts with sync design docs | Cross-subsystem invariant conflict (library ↔ LOCKER_SYNC) | `docs/audit/library-analysis.md` Verified Fact §8; `docs/audit/library-invariants.md` (tombstone invariant); `src/lockerSync.ts` `applyTrackTombstonesFromManifest` (returns 0, logs skip); `LOCKER_SYNC.md` Phase 3 marks delete propagation complete | **Medium** | Align docs with no-op behavior or implement opt-in tombstone apply behind user confirmation |
| Packaged desktop tier34 spawn path vs Docker tier34 entry use different artifacts (`tier34-server.mjs` vs `npx tsx` source tree) | Duplicated abstraction (deployment ↔ launcher) | `docs/audit/launcher-analysis.md` Verified Fact §2–3; `docs/audit/deployment-analysis.md` Verified Fact §6; `src-tauri/src/local_server.rs` `bundled_tier34_entry`, `spawn_tier34`; `Dockerfile.tier34` CMD | **Medium** | Document two supported shapes explicitly; optional CI smoke for both paths |
| `raceTierHits` first-wins under STANDARD/HIGH fidelity can return proxy before debrid completes | Policy invariant tension (provider internal) | `docs/audit/provider-invariants.md` (`raceTierHits` row); `docs/audit/provider-analysis.md` Weakness §1 | **Medium** | Cancel or deprioritize lower tiers when higher tier is in-flight; or document STANDARD as latency-first |

---

## Summary

| Metric | Count |
|--------|------:|
| Violations documented | 11 |
| High severity | 5 |
| Medium severity | 6 |
| Circular dependency violations evidenced | 0 |

---

## Evidence index

```yaml
evidence:
  pass2_artifacts:
    - docs/audit/launcher-analysis.md
    - docs/audit/provider-invariants.md
    - docs/audit/library-analysis.md
    - docs/audit/audio-analysis.md
    - docs/audit/playback-queue-analysis.md
    - docs/audit/deployment-analysis.md
  code_symbols:
    - sandboxLayer3.tsx
    - lockerStorage.ts
    - sandboxLayer2.searchArchive
    - sandboxLayer2.searchCatalogProvider
    - applyTrackTombstonesFromManifest
    - findQueueIndexForExoUrl
    - bundled_tier34_entry
  confidence: High
  evidence_type: cross_reference
```
