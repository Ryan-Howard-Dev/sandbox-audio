# Pass 3 — Documentation Drift

Cross-check of operator-facing docs against Pass 2 code audits. **Audit date: 2026-07-21.** Status legend: **Confirmed** = doc contradicts verified code; **Partial** = doc partly true or incomplete; **Unsupported** = doc claim not evidenced in code; **Verified** = doc matches Pass 2 findings.

---

| Doc file | Claim | Audit finding | Status | Notes |
|----------|-------|---------------|--------|-------|
| `docs/sandbox-architecture.md` | §4 B: "Tauri embeds the static web client; tier34 is **not** embedded" | `src-tauri/tauri.conf.json` `beforeBuildCommand` runs `build:tier34`; bundles `../dist/` including `tier34-server.mjs` (`launcher-analysis.md` Verified Fact §3) | **Confirmed** | Top-of-file warning flags §4/5/10; §4 B body still states not embedded |
| `docs/sandbox-architecture.md` | §5: Anchor Start spawns `npx tsx tier34-server/index.ts` from project root | `local_server.rs` `bundled_tier34_entry()` prefers `tier34-server.mjs` / `.cjs`; dev fallback is `npx tsx` (`launcher-analysis.md` Verified Fact §2) | **Confirmed** | Doc describes dev path only; packaged path is bundled `.mjs` + `node` |
| `docs/sandbox-architecture.md` | §5: "Packaged installs without the tier34 source tree still need a remote tier34 URL or manual `npm run dev:tier34`" | Tauri release bundles `dist/tier34-server.mjs` in resources (`deployment-analysis.md` Verified Fact §4; `launcher-invariants.md` packaged spawn row) | **Confirmed** | Mental model §6 (line ~395) repeats same claim |
| `docs/sandbox-architecture.md` | §10 / Mental model §6: packaged installs do not bundle tier34 | Same as above — `build:tier34` + Tauri `bundle.resources` include tier34 bundle | **Confirmed** | Dev commands §10 correctly describe `dev:all` / separate tier34 for dev |
| `docs/sandbox-architecture.md` | §6 diagram: anchor auto-start as `npx tsx tier34-server` | Packaged anchor uses `node tier34-server.mjs` when bundle present (`launcher-analysis.md`) | **Partial** | Accurate for git-checkout dev; inaccurate for release desktop |
| `docs/sandbox-architecture.md` | §6 Desktop: "Run tier34 separately; `npm run tauri:dev` + `dev:tier34`" | Anchor auto-start on shell mount + `ensureTier34ForPlayback` on desktop (`launcher-analysis.md` Verified Facts §5–6) | **Partial** | Manual separate process is one path; anchor mode automates spawn on Tauri |
| `docs/sandbox-architecture.md` | §7 Air-Gap Mode blocks client outbound catalog/acquire but allows LAN tier34 locker APIs | `searchProxy`/`searchDebrid` gated by `isAirGapEnabled()`; `searchArchive`/`searchCatalogProvider` in `sandboxLayer2.ts` are not (`provider-analysis.md` Weakness §5) | **Partial** | Tier34-gated paths blocked; direct archive.org/iTunes client calls are not |
| `docs/offline-capability.md` | Air-Gap "patches fetch" and blocks outbound catalog/metadata/acquire routes | `airGapMode.ts` + `searchProviders.ts` gates; `sandboxLayer2.searchArchive` / `searchCatalogProvider` bypass air-gap (`provider-invariants.md`) | **Partial** | Graceful degradation table cites `searchCatalog.ts` short-circuit but not `sandboxLayer2` direct providers |
| `docs/offline-capability.md` | Air-gap allows "localhost and RFC1918 tier34 locker blobs, search/graph on LAN" | Consistent for tier34 HTTP client paths that check air-gap; inconsistent for direct WAN catalog/archive calls from Layer 2 | **Partial** | Same gap as provider Pass 2 finding |
| `docs/air-gap-lan-party.md` | "Outbound WAN fetches are blocked (catalog proxies, acquire, podcast RSS proxies, etc.)" | Tier34 addon/proxy/debrid paths return `[]` when air-gap on; `searchArchive`/`searchCatalogProvider` still fetch archive.org / iTunes from browser (`provider-analysis.md`) | **Confirmed** | Doc implies complete WAN block; code has client-direct exceptions |
| `docs/air-gap-lan-party.md` | "Search is locker-only" under LAN party (Pop!_OS section) | `tieredFanOut` still invokes `searchCatalogProvider` and `searchArchive` unless separately blocked (`sandboxLayer2.ts` `tieredFanOut`) | **Partial** | Unified search may still hit catalog/archive providers |
| `docs/INFRASTRUCTURE.md` | Constraints: "No `ed25519-dalek` … dependencies until respective implementation phases" | `src-tauri/Cargo.toml` lists `ed25519-dalek`; `src-tauri/src/identity.rs` uses `SigningKey::generate` (`dependencies.md` Rust table) | **Confirmed** | `identity_authority.rs` scaffold remains; taste/identity signing uses ed25519-dalek today |
| `docs/INFRASTRUCTURE.md` | All four infrastructure layers "STATUS: FOUNDATION SCAFFOLD" — no production logic | Matches `infrastructure/*.rs` placeholder APIs (`INFRASTRUCTURE.md` body); does not contradict Pass 2 | **Verified** | Drift is only the ed25519 dependency line in Constraints |
| `docs/INFRASTRUCTURE.md` | Unified data layer "Does **not** migrate frontend `lockerStorage` (IndexedDB)" | Client locker remains IDB-backed per `library-analysis.md` | **Verified** | — |
| `docs/offline-capability.md` | Locker playback works without tier34 for local IndexedDB blobs | `library-analysis.md` + `ensureLockerPlayable` Android `content://` path | **Verified** | — |
| `docs/offline-capability.md` | `npm start` / PWA shell offline after first visit via Workbox | `deployment-analysis.md`: `npm start` → UI server only; PWA precache in `vite.config.ts` per offline doc | **Verified** | Tier34 not started by `npm start` (deployment invariant) — offline doc does not claim full stack |
| `LOCKER_SYNC.md` (referenced by library audit) | Phase 3: "[x] Delete propagation for locker track tombstones (`trackTombstones[]` in manifest)" | `applyTrackTombstonesFromManifest` returns 0 and logs skip (`library-analysis.md` Verified Fact §8) | **Confirmed** | Tombstones export on local delete; pull does not delete peer rows |
| `docs/sandbox-architecture.md` | Android/Capacitor: "no bundled tier34 in the app package" | Capacitor ships `dist/` only; tier34 is separate process or remote URL (`deployment-analysis.md` Android row) | **Verified** | Desktop Tauri differs (bundled sidecar) |

---

## Summary

| Metric | Count |
|--------|------:|
| Drift rows | 17 |
| Confirmed | 7 |
| Partial | 6 |
| Verified | 4 |
| Unsupported | 0 |

---

## Evidence index

```yaml
evidence:
  docs:
    - docs/sandbox-architecture.md
    - docs/offline-capability.md
    - docs/air-gap-lan-party.md
    - docs/INFRASTRUCTURE.md
    - LOCKER_SYNC.md
  pass2:
    - docs/audit/launcher-analysis.md
    - docs/audit/provider-analysis.md
    - docs/audit/library-analysis.md
    - docs/audit/deployment-analysis.md
  confidence: High
  evidence_type: documentation_cross_check
```
