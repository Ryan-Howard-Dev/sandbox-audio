# Pass 3 — Unknowns

Questions that cannot be answered from Pass 1–2 audit evidence or documented code inspection in this pass. **Audit date: 2026-07-21.** Only items marked **Unknown** or **Low** confidence in Pass 2 (with search evidence) are included unless noted as required known unknowns.

---

| Question | Evidence searched | Files inspected | Why the answer cannot be determined |
|----------|-------------------|-----------------|-------------------------------------|
| Does Tauri desktop `nativeAudiophile` path support gapless queue priming equivalent to Android `primeLockerNativeQueue`? | `audio-analysis.md` Engineering Assessment §7 (confidence **Low**); grep `primeLockerNativeQueue` in `src-tauri/` | `src/nativeAudiophile.ts`, `src/sandboxLayer1.ts`, `src/trackPrefetch.ts`, `src-tauri/` (not fully traced per audio-analysis counter_evidence) | Pass 2 audio audit explicitly left Tauri native queue priming unverified; Android-specific `primeLockerNativeQueue` has no evidenced Tauri counterpart |
| What is Soulseek/slskd addon behavior under load (timeouts, worker backpressure, failure modes)? | `provider-analysis.md` Unknown §1 (confidence **Unknown**) | `tier34-server/lib/addonResolve.ts` (route handlers noted present); worker integration not traced | Pass 2 states route handlers exist but worker integration under load was not traced; no load/stress test artifacts in audit scope |
| Is Play Store publish automated from this repository (Fastlane lanes, CI upload)? | `deployment-analysis.md` Verified Fact §9; `deployment-invariants.md` fastlane row (confidence **Unknown**) | `fastlane/metadata/android/en-US/*.txt`, `.github/workflows/release.yml`, `fastlane/` (no `Fastfile`) | Repo contains listing text only; no `Fastfile` or workflow step evidencing Play Console upload |
| Should remote track tombstones delete local rows on manifest pull per `LOCKER_SYNC.md`, or remain export-only per `applyTrackTombstonesFromManifest` no-op? | `library-analysis.md` Verified Fact §8; `library-invariants.md` tombstone row; `LOCKER_SYNC.md` Phase 3 checklist | `src/lockerSync.ts` `applyTrackTombstonesFromManifest`, `src/lockerTrackTombstones.ts`, `LOCKER_SYNC.md` | Code and product doc disagree; Pass 2 did not resolve intended final semantics or user-facing delete-on-sync UX |
| Does bundled `tier34-server.mjs` resolve `lockerPaths` storage to the same directory as dev `tier34-server/storage/` on end-user machines? | `launcher-analysis.md` Verified Fact §10 (confidence **Medium**); `launcher-invariants.md` storage path row | `tier34-server/lib/lockerPaths.ts`, `scripts/build-tier34.mjs`, `src-tauri/src/local_server.rs` | `__dirname` semantics differ for esbuild bundle vs source tree; audit did not execute packaged runtime path resolution |
| Are all search UI entry points passing `catalogOnly` to `engineSearch` when album/chart context requires it? | `provider-analysis.md` Unknown §2 (confidence **Medium**) | `src/sandboxLayer2.ts` `engineSearch` option; not all call sites verified in Pass 2 | Option exists in provider layer; Pass 2 did not complete caller audit across stations/search UI |
| Do all `executeTrack` / play paths enforce `isPlaybackDowngrade` before replacing a full stream with catalog preview? | `provider-analysis.md` Unknown §3 (confidence **Medium**); `provider-invariants.md` downgrade row | `src/playbackPipeline.ts` `isPlaybackDowngrade` (exported); `sandboxLayer3.tsx` (caller audit incomplete per Pass 2) | Function exists; Pass 2 states enforcement at shell callers was not exhaustively verified |
| What is desktop/Tauri queue parity with Android Exo dual-queue reconciliation? | `playback-queue-analysis.md` Engineering Assessment §6 (confidence **Low**) | `src/sandboxLayer1.ts` `nativeAudiophileRef`, `src/trackPrefetch.ts`, `src-tauri/` | Pass 2 queue audit scoped Android Exo; Tauri audiophile participation in FSM noted but queue native priming not in scope list |
| Does `spread-host.mjs` deployment orchestrator exist under another name or external repo? | `deployment-analysis.md` filesystem absence (confidence **High** for absence only) | `scripts/spread-host.mjs`, ripgrep `spread-host` across `*.{md,ts,json,mjs,sh,yml}` | File absent in repo; Pass 2 cannot determine if name is legacy, planned, or lives outside workspace |
| On Linux/macOS packaged Tauri anchor, is system `node` on PATH sufficient when `fetch-portable-node.mjs` skips non-Windows? | `launcher-analysis.md` Top risk #3; `deployment-invariants.md` portable Node row | `scripts/fetch-portable-node.mjs`, `src-tauri/src/local_server.rs` `resolve_node_executable` | Pass 2 evidences Windows portable Node bundle only; non-Windows packaged spawn success depends on end-user environment not audited |

---

## Summary

| Metric | Count |
|--------|------:|
| Unknown rows | 10 |
| Required known unknowns (per Pass 3 brief) | 4 |
| Additional Pass 2 Unknown/Low items | 6 |

---

## Evidence index

```yaml
evidence:
  pass2_unknowns:
    - docs/audit/audio-analysis.md
    - docs/audit/provider-analysis.md
    - docs/audit/deployment-analysis.md
    - docs/audit/library-analysis.md
    - docs/audit/playback-queue-analysis.md
    - docs/audit/launcher-analysis.md
  confidence: High
  evidence_type: audit_scope_limit
```
