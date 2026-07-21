# Repository Health

Synthesized from Pass 1–3 audit artifacts and `CODEBASE_HEALTH.md`. **Audit synthesis date: 2026-07-21.** Figures marked **[Snapshot: 2026-07-09]** come from `CODEBASE_HEALTH.md` and were not re-measured in Pass 2.

---

## Line-count hotspots

| File | Lines | Source | Notes |
|------|------:|--------|-------|
| `src/sandboxLayer3.tsx` | **8,040** | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | God-file — shell, play handler, queue, search, JSX |
| `src/sandboxLayer3.tsx` | **~9,550** | `architecture-violations.md`, `playback-queue-analysis.md` | Pass 2 grep/line count — **newer than July snapshot** |
| `src/lockerStorage.ts` | **3,084** | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | IndexedDB locker, heal, sync |
| `src/lockerStorage.ts` | **~5,076** | `library-analysis.md` | Pass 2 surface-area estimate |
| `src/searchCatalog.ts` | 3,562 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | Catalog search |
| `src/sandboxLayer1.ts` | 2,460 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | Audio FSM |
| `src/sandboxLayer2.ts` | 1,790 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | Provider layer |
| `android/.../NativeExoPlaybackPlugin.java` | 1,109 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** | Native Exo bridge |

**Scale (approx.):** ~567 TS/Rust source files, ~120k LOC per `CODEBASE_HEALTH.md` / `docs/CHRONICLE.md` **[Snapshot: 2026-07-09]**.

---

## TypeScript health

| Metric | Status | Source |
|--------|--------|--------|
| `npm run lint` (`tsc --noEmit`) | **Fails — 13 errors** | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |
| Affected areas (per snapshot) | `ensureLockerPlayable.ts`, `sovereignUpNext.ts`, `podcastTranscript.test.ts`, `tier34-server/routes/podcast*.ts` | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |

Pass 2 did not re-run `tsc`. Treat error count as stale until re-verified.

---

## Unit test health

| Metric | Status | Source |
|--------|--------|--------|
| Vitest files | 124 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |
| Vitest tests | 544 | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |
| **Failing tests** | **3** | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |
| Failing files (per snapshot) | `lockerFuzzyMatch.test.ts`, `mobileAcquisition.test.ts`, `importPlaylistAcquisition.test.ts` | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]** |

Pass 2 noted dedicated locker/durability/delete-guard tests (`library-analysis.md`) but did not re-run Vitest.

---

## Test coverage signals (Pass 2)

| Area | Coverage signal | Confidence | Source |
|------|-----------------|------------|--------|
| Playback queue policy | Dedicated unit tests (`queueAdvancePolicy`, `queueAdvanceGate`, `albumPlayQueue`, `exoQueueSync`) | High | `playback-queue-analysis.md` Engineering Assessment |
| Locker durability / delete guards | `lockerDurability.test.ts`, `lockerDeleteGuard.test.ts`, `lockerPlayableFilter.test.ts` | Medium | `library-analysis.md` |
| Launcher spawn / bundled tier34 | No automated integration tests | High | `launcher-analysis.md` Test gaps |
| Docker compose tier34 smoke | No CI `docker compose up` health job | High | `deployment-analysis.md` Test gaps |
| Desktop bundle contains `tier34-server.mjs` | No automated assertion in CI | High | `deployment-analysis.md` Test gaps |
| Boot heal ordering | Indirect via E2E/stress scripts; not verified as CI gate | Medium | `library-analysis.md` |

---

## Phone E2E gate

| Item | Status | Source |
|------|--------|--------|
| E2E scripts / workflows exist | Yes (`phone-e2e-gate.yml`, `nightly-e2e.yml` referenced) | `deployment-analysis.md` |
| Enforced on every release build | **No** | `CODEBASE_HEALTH.md` **[Snapshot: 2026-07-09]**; `deployment-analysis.md` (E2E referenced, not blocking `publish` for all paths) |

---

## Dead / generated paths

From `repository-map.md` (Pass 1):

| Path | Classification |
|------|----------------|
| `dist/` | Dead (generated) — Vite + `server.cjs` |
| `node_modules/` | Dead (generated) |
| `android/app/build/`, `android/build/` | Dead (generated) |
| `src-tauri/target/` | Dead (generated) |
| `.idea/`, `.jdk21/` | Dead (local) |
| `proof-screenshots/`, `proof-oneplus-46349770/` | Experimental — QA artifacts |
| `_apk_check/` | Experimental — investigation scratch |
| `STATUS.md` | Deprecated — redirects to CHANGELOG, CODEBASE_HEALTH, CHRONICLE |

---

## CI / release health (Pass 2 verified)

| Check | Behavior | Source |
|-------|----------|--------|
| TypeScript gate | CI runs `npm run lint` before build jobs | `deployment-analysis.md` Verified Fact §7; README claims (not re-audited in Pass 2) |
| PWA precache budget | CI fails if precache > 3.5 MiB or single chunk > 2.8 MiB | `deployment-invariants.md` |
| GitHub Release | Tag `v*` triggers multi-platform publish | `deployment-analysis.md` Verified Fact §7 |
| Missing deploy orchestrator | `scripts/spread-host.mjs` absent | `deployment-analysis.md` Verified Fact §1 |

---

## Architectural health (Pass 3)

| Metric | Count | Source |
|--------|------:|--------|
| Architecture violations documented | 11 | `architecture-violations.md` |
| High severity | 5 | `architecture-violations.md` |
| Documentation drift rows | 17 (7 Confirmed) | `documentation-drift.md` |
| Unknowns (unresolved) | 10 | `unknowns.md` |

---

## Strengths (audit-backed)

- Broad Vitest surface for playback, locker, search, and catalog paths **[Snapshot: 2026-07-09]** — `CODEBASE_HEALTH.md`
- Partial shell extraction (`src/play/`, hooks, lazy stations) — `CODEBASE_HEALTH.md`, `repository-map.md` (`src/play/` Evolving)
- Explicit locker delete guards and `LOCKER_NEVER_AUTO_DELETE` — `library-analysis.md` Verified Fact §2
- Mature CI matrix (web, Tauri Linux/Windows, Android) — `deployment-analysis.md` Strengths
- OEM-aware Android gapless mitigations — `playback-queue-analysis.md`, `audio-analysis.md`

---

## Recommendations (from audits; non-blocking)

1. Re-run `npm run lint` and Vitest to refresh **[Snapshot: 2026-07-09]** figures.
2. Fix or quarantine 3 failing unit tests before next tagged release — `CODEBASE_HEALTH.md`
3. Continue `sandboxLayer3.tsx` incremental split per `CODEBASE_HEALTH.md` — only after playback E2E green on device (per split plan).
4. Resolve top risks in [risk-register.md](./risk-register.md) — especially R-001, R-003, R-005, R-007, R-008, R-009.

---

See also: [CODEBASE_HEALTH.md](../CODEBASE_HEALTH.md) · [risk-register.md](./risk-register.md) · [executive-summary.md](./executive-summary.md)
