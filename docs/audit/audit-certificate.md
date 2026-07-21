# Pass 5 — Repository Audit Certificate

## Repository Audit Certificate — Sovereign Music Console

- Audit Type: Evidence-based Multi-Pass (Passes 1–5)
- Repository: sovereign-music-console
- Revision: Not captured
- Audit completed: 2026-07-21
- Files examined: ~210 unique paths (Pass 1: 103 project `*.md`/`*.mdc` via search-scope glob + 16 root config/manifest files; Pass 2: 129 unique code/config paths deduplicated from `files:` / `files_inspected:` YAML in six `*-analysis.md` audits; ~38 overlap → ~210 union)
- Directories examined: 18 (per `search-scope.md` directory table)
- Pass 2 subsystems audited: launcher, provider, deployment, library, audio, playback-queue
- Pass 2 subsystems deferred: cast/Chromecast (`castPlatform.ts`, `cast_browser_server.rs`), Sandbox Connect / peer sync (`tier34/peerSync.ts`, `connectProtocol.ts`), UI shell & stations (`src/stations/*`, `src/components/*`), podcast subsystem (`podcastStorage.ts`, `podcastPlayback.ts`, tier34 podcast routes), catalog search (`searchCatalog.ts`), tier34-server routes & acquire workers (beyond `/health` entry), overlay / Headscale / HTTP3 stack, DLNA / OpenSubsonic / MediaServer, federated taste & scrobbling, Android Auto / TV / wake-alarm, demucs/stems, addon UI/storage (beyond resolve adapters), i18n/locales, Gemini playlist curation (`server.ts` AI routes), air-gap feature module (`airGapMode.ts` — policy gaps noted in provider pass only)
- Evidence-backed claims (High confidence): 88
- Interpretive statements (Medium confidence): 13
- Unverified / Low confidence claims: 2
- Unknown findings: 10

- High: 88
- Medium: 13
- Low: 2
- Unknown: 10

**Overall Audit Reliability:** This certificate synthesizes Passes 1–5 over a non-git workspace snapshot (no `git` revision captured). Confidence totals were derived by systematically counting `confidence:` tags in Pass 2 `*-analysis.md` YAML evidence blocks (`rg 'confidence:'` across six subsystem analyses: 88 High, 13 Medium, 2 Low, 0 Unknown in YAML; 10 additional Unknown rows from `unknowns.md`). High-confidence claims are disproportionately concentrated in six audited subsystems (~129 deeply cited source paths); ~400+ other `src/` modules and most tier34 routes were classified by inventory only. Pass 1 markdown files were heading-verified or inventoried, not content-audited. `CODEBASE_HEALTH.md` test/lint figures are **[Snapshot: 2026-07-09]** and were not re-executed. The audit is reliable for architecture, invariant conflicts, and deployment/launcher/provider/playback-library boundaries; it is not a penetration test, runtime certification, or exhaustive line-by-line review of `sandboxLayer3.tsx` (~9.5k lines) or `lockerStorage.ts` (~5k lines).

---

## Certification Liabilities

Senior-engineer liabilities flagged during Pass 5 validation (strict list):

- **Single-source evidence — `spread-host.mjs` absence:** Filesystem `Test-Path` + ripgrep zero-match only; cannot confirm whether orchestrator was renamed, never committed, or lives in an external repo (`unknowns.md` row 9; `deployment-analysis.md` Verified Fact §1).
- **Single-source evidence — Linux/macOS packaged Node:** Windows-only `fetch-portable-node.mjs` evidenced; non-Windows anchor spawn success depends on end-user `PATH`, not exercised in packaged runtime (`unknowns.md` row 10; `launcher-analysis.md` Top risk #3).
- **Single-source evidence — bundled tier34 storage path:** `lockerPaths.ts` `__dirname` semantics for esbuild bundle vs dev tree assessed at Medium confidence only; no packaged-runtime path probe (`unknowns.md` row 5).
- **Single-source evidence — Tauri queue/gapless parity:** No evidenced `primeLockerNativeQueue` counterpart on desktop; Pass 2 audio/queue assessments marked **Low** (`unknowns.md` rows 1, 8; `audio-analysis.md` Engineering Assessment §7).
- **Single-source evidence — Soulseek/slskd under load:** Route handlers noted; worker integration and backpressure not traced (`unknowns.md` row 2; `provider-analysis.md` Unknown §1).
- **Single-source evidence — Play Store automation:** `fastlane/` listing text only; no `Fastfile` or CI upload step (`unknowns.md` row 3; `deployment-invariants.md` fastlane row).
- **Single-source evidence — `catalogOnly` / `isPlaybackDowngrade` caller coverage:** Functions exist in provider/playback layers; shell caller audit incomplete at Medium confidence (`unknowns.md` rows 6–7).
- **Single-source evidence — repository health metrics:** 13 TypeScript errors, 3 failing Vitest tests, and 124/544 test counts sourced solely from `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]**; Pass 2 did not re-run `npm run lint` or Vitest (`repository-health.md`).
- **Single-source evidence — `sandboxLayer3.tsx` scale:** Conflicting line counts (8,040 vs ~9,550) from July snapshot vs Pass 2 grep; god-file scope inferred from imports, not full read (`repository-health.md`, `architecture-violations.md`).
- **Invariants without test coverage — launcher spawn / health gate:** `local_server.rs` bundled-vs-dev path selection, stderr discard, port-3001 contention, and `stop_local_server` on exit have no automated integration tests (`launcher-analysis.md` Test gaps; `launcher-invariants.md` readiness/port rows).
- **Invariants without test coverage — deployment packaging:** No CI assertion that `build:desktop` places `tier34-server.mjs` in Tauri resources; no `docker compose up` health smoke job (`deployment-analysis.md` Test gaps; `repository-health.md` Test coverage signals).
- **Invariants without test coverage — provider air-gap & mobile catalog bypass:** `sandboxLayer2.searchArchive` / `searchCatalogProvider` bypass `isAirGapEnabled()`; `resolutionSource === 'mobile'` bypasses `resolvedStreamMatchesCatalog` — no regression tests cited (`provider-invariants.md`; `architecture-violations.md`).
- **Invariants without test coverage — dual-queue reconciliation:** `findQueueIndexForExoUrl`, `shouldSuppressJsAdvanceAfterNativeGapless`, and native `mediaItemTransition` URL matching lack integration/E2E gate despite **High** violation risk (`playback-queue-invariants.md`; `repository-health.md` Phone E2E not release-gated).
- **Invariants without test coverage — audio focus / wired DAC / cast URL:** Native focus-loss pause, screen-lock keepalive, wired-route recovery, and speaker-cast HTTP URL requirements documented in `audio-invariants.md` without dedicated automated tests in audit evidence.
- **Invariants without test coverage — library boot heal ordering:** `runAfterBootInteractive` / `verifyLockerIntegrityOnBoot` ordering exercised indirectly via stress scripts, not verified as CI gate (`library-analysis.md`; `repository-health.md`).
- **Invariants without test coverage — remote tombstone no-op:** `applyTrackTombstonesFromManifest` returns 0 — no test enforcing sync-doc vs code alignment (`library-invariants.md` tombstone row; `LOCKER_SYNC.md` drift).
- **High-impact risks with procedural-only mitigations:** R-014 (`npm start` UI-only) and R-015 (absent `spread-host.mjs`) mitigations are operator runbook/documentation, not enforced in code or CI (`risk-register.md`). R-019 (doc drift on bundled tier34) mitigation is doc update only — 7 Confirmed drift rows remain (`documentation-drift.md`). R-020 (phone E2E not release-gated) mitigation is checklist/optional workflow wiring.
- **README claims not traceable to High-confidence Pass 2 finding — podcast subscription:** README states podcast playback; no Pass 2 subsystem audit of `podcastStorage.ts`, `podcastPlayback.ts`, or tier34 podcast routes.
- **README claims not traceable to High-confidence Pass 2 finding — catalog browse breadth:** README implies general catalog exploration; `searchCatalog.ts` (~3.5k LOC per snapshot) was out of Pass 2 provider scope (provider pass covers `sandboxLayer2` orchestration, not full catalog module).
- **README claims not traceable to High-confidence Pass 2 finding — cross-device sync semantics:** README "Cross-device" bullet implies working sync; tombstone delete-on-pull is a documented no-op with **Confirmed** `LOCKER_SYNC.md` drift — only Medium/Low confidence on intended product semantics (`library-analysis.md` Verified Fact §8; `unknowns.md` row 4).
- **ADRs marked "Inferred — not formally documented":** **None.** All four ADRs (`001`–`004`) show **Status: Accepted** with Pass 2 evidence citations; Pass 4 synthesis confirmed formal documentation.

---

## Methodology note (Pass 5)

| Step | Action |
|------|--------|
| 1 | Read all `docs/audit/*`, `docs/risk-register.md`, `docs/repository-health.md`, `docs/executive-summary.md`, `adr/*`, `README.md` |
| 2 | Count `confidence:` in Pass 2 `*-analysis.md` via systematic grep (103 YAML tags) |
| 3 | Cross-reference invariants vs `repository-health.md` test-coverage signals and `deployment-analysis.md` test gaps |
| 4 | Cross-reference `risk-register.md` mitigations vs implementation evidence |
| 5 | Validate README claims against High-confidence YAML blocks only |
| 6 | Verify ADR status fields |

**Pass 5 HALT** — no Pass 6 planned in audit brief.
