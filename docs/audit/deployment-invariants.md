# Pass 2 — Deployment Automation Invariants

Subsystem scope: **build, package, publish, and self-host stack deployment** for Sandbox Music. Nominal center: `scripts/spread-host.mjs` (audited as boundary anchor). **Code-only audit — 2026-07-21.**

**Out of scope:** runtime tier34 child-process launch (`src-tauri/src/local_server.rs` — see `launcher-invariants.md`); tier34 route/worker logic; Android E2E test scripts; host OS tuning (`scripts/linux-tcp-bbr.sh`, `linux-network-bonding.sh`).

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| `scripts/spread-host.mjs` is not present in the repository | Pass 2 names this file as the deployment orchestrator; absence means no single scripted entry for host spread/deploy | `Test-Path scripts/spread-host.mjs` → `False`; glob of `scripts/*.mjs` has no `spread-host.mjs`; ripgrep `spread-host\|spreadHost\|spread_host` over `*.{md,ts,json,mjs,sh,yml}` → zero matches | **High** — operators expecting a unified deploy script will not find it; deployment is fragmented across npm scripts, CI, and Docker |
| No `package.json` script references `spread-host`, `deploy`, or `spread` | npm is the primary local automation surface; missing wiring confirms no CLI deploy orchestrator | `package.json` `scripts` block: no keys matching spread/deploy/host-spread; closest host-related script is `dev:tier34` (tier34 dev only) | **Medium** — discoverability gap; self-host docs point to `docker compose` and manual npm commands instead |
| Production web start (`npm start`) launches only the UI server bundle | Web/PWA prod path does not deploy or start tier34/Meilisearch | `scripts/start-prod.mjs` spawns `dist/server.cjs` with `NODE_ENV=production` only; no tier34 spawn | **High** — `npm start` after `npm run build` is not a full-stack deployment |
| Client production build is gated by TypeScript lint | Broken types block release artifacts | `package.json`: `prebuild:client` → `npm run lint`; `build:client` → `check:platform` + `vite build` | **Low** — intentional quality gate |
| Tauri desktop release bundles client + tier34 before `tauri build` | Packaged desktop must include `dist/` and `tier34-server.mjs` in resources | `src-tauri/tauri.conf.json` `beforeBuildCommand`: `npm run build:client && npm run build:tier34`; `bundle.resources`: `../dist/`, `resources/node/` | **Medium** — skipping `build:desktop` steps yields install missing sidecar bundle |
| `build:tier34` emits a single-file ESM bundle at `dist/tier34-server.mjs` | Desktop anchor spawn and Tauri resources depend on this artifact | `scripts/build-tier34.mjs`: esbuild entry `tier34-server/index.ts` → `dist/tier34-server.mjs` | **Medium** — Docker path uses source + `tsx` instead; two artifact shapes coexist |
| Portable Node fetch is Windows-only and non-fatal on failure | Linux/macOS desktop bundles lack bundled `node.exe`; CI Linux Tauri builds skip fetch | `scripts/fetch-portable-node.mjs`: exits 0 on non-`win32`; catch block exits 0 with fallback message; hooked via `prebuild:desktop:assets` | **High** on Linux/macOS packaged desktop — anchor may need system Node on PATH |
| Docker tier34 image runs unbundled source via `npx tsx` | Container deploy path differs from desktop esbuild bundle | `Dockerfile.tier34` `CMD ["npx", "tsx", "tier34-server/index.ts"]`; copies `tier34-server/` tree, not `dist/tier34-server.mjs` | **Low** by design — but behavior diverges from packaged desktop |
| Base compose stack pins tier34 to port 3001 with CORS `http://localhost:3002` | UI and API origin pairing must match client defaults | `docker-compose.yml` `tier34.environment`: `TIER34_PORT: "3001"`, `TIER34_CORS_ORIGIN: "http://localhost:3002"` | **Medium** — remote UI or overlay HTTPS gateway requires env overrides |
| GitHub Release workflow triggers only on `v*` tags | Tagged releases are the automated multi-artifact publish path | `.github/workflows/release.yml` `on.push.tags: ['v*']` | **Low** — untagged builds stay CI-artifact-only |
| Release publish job depends on web, both Tauri platforms, and signed Android | Partial pipeline failure blocks GitHub Release creation | `release.yml` `publish.needs`: `build-web`, `build-tauri-linux`, `build-tauri-windows`, `android-signed-release`, E2E jobs | **Medium** — one failing gate blocks all release assets |
| CI web job enforces PWA precache size budget | Oversized client bundle fails CI before artifact upload | `.github/workflows/ci.yml` web job: Node script throws if precache total > 3.5 MiB or single chunk > 2.8 MiB | **Low** — intentional bundle-size invariant |
| F-Droid parity prebuild runs `npm ci`, `build:client`, `cap sync android` | Reproducible Android release layout for F-Droid verification | `scripts/fdroid-prebuild.mjs` sequential `spawnSync` of those three steps | **Medium** — drift from `metadata/fdroid/` if prebuild steps change without updating F-Droid metadata |
| Signed Android release in CI requires four `ANDROID_*` secrets | Missing secrets fail keystore decode before Gradle | `scripts/android-ci-keystore.mjs` `requireEnv` on `ANDROID_KEYSTORE_BASE64`, passwords, alias | **High** in CI — unsigned path uses `fdroid:local` / unsigned APK naming |
| `android-package-release-apks.mjs` requires existing Gradle APK output directory | Packaging step cannot run without prior `assembleRelease` | Exits 1 if `android/app/build/outputs/apk/release` missing or empty | **Low** — ordering dependency in release workflows |
| `check-platform.mjs` validates project layout per build target | Android/Tauri builds fail fast if required paths missing | `PROJECT_CHECKS` maps `web`/`android`/`tauri` to required paths; missing → `process.exit(1)` | **Low** |
| Overlay stack extends base compose via second file (not standalone) | Remote access deploy requires merging compose files and env | `docker-compose.overlay.yml` header documents `docker compose -f docker-compose.yml -f docker-compose.overlay.yml`; adds Headscale, Caddy gateway, Tailscale sidecar | **Medium** — manual multi-file compose; no repo script automates overlay bring-up |
| `fastlane/` contains Play Store listing text only | No automated Play deployment from repo | `fastlane/metadata/android/en-US/*.txt` — description files only; no `Fastfile` in repo | **Unknown** — Play publish may be manual outside repo |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
    - package.json
    - scripts/start-prod.mjs
    - scripts/build-tier34.mjs
    - scripts/fetch-portable-node.mjs
    - scripts/fdroid-prebuild.mjs
    - scripts/android-package-release-apks.mjs
    - scripts/android-ci-keystore.mjs
    - scripts/check-platform.mjs
    - scripts/tauri-build.mjs
    - src-tauri/tauri.conf.json
    - Dockerfile.tier34
    - docker-compose.yml
    - docker-compose.overlay.yml
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
    - fastlane/metadata/android/en-US/full_description.txt
  symbols:
    - build:client
    - build:tier34
    - build:desktop
    - prebuild:desktop:assets
    - fdroid:prebuild
    - fdroid:local
  confidence: High
  evidence_type:
    - implementation
    - configuration
    - filesystem_absence
counter_evidence:
  files_inspected:
    - scripts/INSTALL-RULES.md
    - src-tauri/src/local_server.rs
  note: spread-host.mjs absent; launcher runtime spawn documented in launcher-invariants.md
```
