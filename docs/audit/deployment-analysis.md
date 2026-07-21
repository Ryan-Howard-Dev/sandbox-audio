# Pass 2 — Deployment Automation Analysis

Subsystem: **Deployment Automation** — build, package, publish, and self-host stack bring-up. Nominal orchestrator: `scripts/spread-host.mjs`. **Code-only audit — 2026-07-21.**

---

## Subsystem boundary

| In scope | Role |
|----------|------|
| `scripts/spread-host.mjs` (nominal) | Intended unified deployment orchestrator — **file absent** |
| `package.json` build/release scripts | Local automation: web, desktop, Android, F-Droid, tier34 bundle |
| `scripts/build-tier34.mjs`, `fetch-portable-node.mjs`, `tauri-build.mjs`, `start-prod.mjs` | Desktop/web packaging adjuncts |
| `scripts/fdroid-*.mjs`, `android-*-release*.mjs`, `android-package-release-apks.mjs`, `android-ci-keystore.mjs` | Android release packaging |
| `scripts/check-platform.mjs`, `vite-android-build.mjs` | Build-target guards and Android Vite wrapper |
| `src-tauri/tauri.conf.json` | Desktop bundle config (`beforeBuildCommand`, `resources`) |
| `Dockerfile.tier34`, `Dockerfile.demucs`, `docker-compose*.yml` | Containerized self-host stack |
| `.github/workflows/ci.yml`, `release.yml` | CI build verification and tagged release publish |
| `fastlane/metadata/` | Play Store listing text (not deploy automation) |
| `SELF_HOST.md` | Operator docs for Docker quick start (referenced, not logic) |

| Out of scope | Reason |
|--------------|--------|
| `src-tauri/src/local_server.rs` | Runtime tier34 spawn — **Launcher** subsystem (`launcher-analysis.md`) |
| `tier34-server/*` business logic | Sandbox Server behavior after deploy |
| `overlay/headscale/*` config content | Coordination server config; compose wiring only in scope |
| E2E/stress `scripts/*.ps1`, `*.sh` | QA automation, not artifact deployment |
| `scripts/linux-tcp-bbr.sh`, `linux-network-bonding.sh` | Post-deploy host tuning |

**Orchestration vs delegation:** No `spread-host.mjs` exists to coordinate deployment. **Orchestration is fragmented:** npm script chains (`build`, `build:desktop`, `fdroid:local`), Tauri `beforeBuildCommand`, GitHub Actions job graphs, and operator-run `docker compose`. **Delegated to external tools:** `docker`/`docker compose`, `tauri build`, Gradle (`gradlew assembleRelease`), `esbuild`, `vite`, `npm ci`, GitHub `softprops/action-gh-release`, Node.js registry (`fetch-portable-node` download).

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
    - package.json
    - src-tauri/tauri.conf.json
    - .github/workflows/release.yml
    - docker-compose.yml
  confidence: High
  evidence_type: filesystem_absence
counter_evidence:
  files_inspected:
    - scripts/INSTALL-RULES.md
    - docs/sandbox-architecture.md
```

---

## Subsystem Interface

### `scripts/spread-host.mjs` (nominal — absent)

| Facet | Value |
|-------|-------|
| Inputs | **Unknown** — file not in repository |
| Outputs | **Unknown** |
| State changes | **Unknown** |
| External dependencies | **Unknown** |
| Called by | **None** — no imports, no `package.json` script, no workflow reference |
| Calls into | **Unknown** |
| Persistence | **Unknown** |
| Threading / async | **Unknown** |

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
    - package.json
  confidence: High
  evidence_type: filesystem_absence
counter_evidence:
  files_inspected:
    - scripts/*.mjs
    - .github/workflows/*.yml
  note: exhaustive search for spread-host identifier in project source extensions returned zero matches
```

### Actual deployment automation (aggregate — code-evident)

#### Inputs

| Input | Source | Consumer |
|-------|--------|----------|
| Repo source tree | git checkout | All build scripts, Docker `COPY` |
| `package.json` / lockfile | npm | `npm ci`, Docker `npm ci`, fdroid prebuild |
| Env: `SANDBOX_BUILD_TARGET`, `SANDBOX_ANDROID_E2E` | shell / `vite-android-build.mjs` | Vite android production build |
| Env: `RELEASE_VERSION`, `GITHUB_REF_NAME` | GitHub Actions | `android-package-release-apks.mjs` naming |
| Env: `ANDROID_KEYSTORE_*` (4 vars) | GitHub secrets | `android-ci-keystore.mjs` |
| Env: `CARGO_TARGET_DIR` override risk | Cursor/sandbox | `tauri-build.mjs` pins to `src-tauri/target` |
| Compose env / `.env.overlay` | operator | `docker-compose.overlay.yml` port and Tailscale hostname vars |
| Git tag `v*` | git push | `release.yml` trigger |

#### Outputs

| Output | Path / artifact |
|--------|-----------------|
| Web client + PWA | `dist/` (Vite) |
| UI production server | `dist/server.cjs` (esbuild in `npm run build` / CI) |
| Tier34 desktop bundle | `dist/tier34-server.mjs` (+ `.map`) |
| Portable Node (Windows) | `src-tauri/resources/node/node.exe` |
| Tauri installers | `src-tauri/target/release/bundle/{deb,appimage,msi,nsis}/` |
| Android APKs | `android/app/build/outputs/apk/{debug,release}/` |
| Release folder | `release-android/` + `SHA256SUMS` |
| Web release tarball | `sovereign-music-console-web.tar.gz` (release workflow) |
| Docker images | `tier34`, optional `demucs` (compose build) |
| GitHub Release assets | merged `artifacts/**` from publish job |

#### State changes

- **Filesystem writes:** `dist/`, `src-tauri/target/`, `release-android/`, `.tmp-node-fetch/` (transient), `android/keystore.properties` + `release.keystore` (CI only)
- **No deployment state DB** or lockfile in repo for deploy progress
- **Docker volumes:** `meili_data`, `tier34_storage`, overlay `headscale_data`, `caddy_*` (runtime, outside repo)

#### External dependencies

| Dependency | Role |
|------------|------|
| Node.js 22 | CI `setup-node`, Docker base image, local builds |
| npm / npx | install, cap sync, tsx in Docker CMD |
| Rust / Cargo | Tauri desktop builds |
| JDK 21 + Android SDK | Android CI and local Gradle |
| Docker Engine | Self-host compose stacks |
| PowerShell | `fetch-portable-node.mjs` `Expand-Archive` on Windows |
| `nodejs.org` CDN | Portable Node zip download |
| GitHub Actions runners | ubuntu-22.04, windows-latest |
| esbuild, vite, tauri CLI | Bundling |

#### Called by

- Developers: `npm run build*`, `fdroid:local`, `docker compose up`
- CI: push/PR to main, tag `v*`
- Tauri: `beforeBuildCommand` during `tauri build`
- **Not called:** any in-app runtime code

#### Calls into

| Caller | Callee chain (representative) |
|--------|-------------------------------|
| `npm run build` | `build:client` → lint + vite; esbuild `server.ts` |
| `npm run build:desktop` | `check-platform.mjs` → `build:client` → `tauri-build.mjs` → `tauri build` |
| `npm run tauri:build` | same as above when invoked via alias |
| `prebuild:desktop:assets` | `generate-tauri-icons.mjs`, `run-generate-nsis-assets.mjs`, `fetch-portable-node.mjs` |
| `tauri.conf.json` beforeBuild | `build:client`, `build:tier34` |
| `npm run fdroid:local` | `fdroid-prebuild.mjs` → `fdroid-assemble-release.mjs` |
| `release.yml` publish | `download-artifact` → `softprops/action-gh-release` |
| `npm start` | `start-prod.mjs` → `node dist/server.cjs` |

#### Persistence

- Build outputs on disk (regenerable)
- Docker named volumes for tier34/meili data (external to git)
- CI secrets for Android signing (GitHub, not repo)
- **No** deploy manifest or version registry inside application code

#### Threading / async behaviour

- **Synchronous child processes:** `spawnSync` in `tauri-build.mjs`, `fdroid-prebuild.mjs`, `check-platform.mjs`, `vite-android-build.mjs`, `android-assemble-release.mjs`
- **Fire-and-forget spawn:** `start-prod.mjs` uses `spawn` without awaiting child exit (UI server daemonizes in shell session)
- **Async fetch:** `fetch-portable-node.mjs` `main()` uses `await fetch` + stream pipeline
- **CI:** parallel jobs (`build-tauri-linux`, `build-tauri-windows`, `web`, Android) with `needs` DAG; no shared in-repo coordinator
- **Docker compose:** declarative multi-container start; no Node orchestrator

```yaml
evidence:
  files:
    - package.json
    - scripts/start-prod.mjs
    - scripts/tauri-build.mjs
    - scripts/fdroid-prebuild.mjs
    - scripts/fetch-portable-node.mjs
    - src-tauri/tauri.conf.json
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - scripts/beets-watch-sync.mjs
  note: beets sync is runtime ingestion adjunct, not release deploy
```

---

## Verified Facts

1. **`scripts/spread-host.mjs` does not exist.** No file at that path; no identifier `spread-host` / `spreadHost` / `spread_host` in project `*.{md,ts,json,mjs,sh,yml}`.

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
  confidence: High
  evidence_type: filesystem_absence
counter_evidence:
  files_inspected:
    - scripts/
    - package.json
    - .github/workflows/
```

2. **`package.json` defines build/release scripts but none named `spread-host` or `deploy`.** Closest deployment-adjacent entries: `build`, `build:desktop`, `build:android:release`, `fdroid:local`, `start` (UI only).

```yaml
evidence:
  files:
    - package.json
  symbols:
    - build
    - build:desktop
    - fdroid:local
    - start
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected: []
```

3. **Web production deploy path produces `dist/` + `dist/server.cjs` but `npm start` does not start tier34.** `build` chains client lint/build and esbuild server bundle; `start` → `start-prod.mjs` spawns only `server.cjs`.

```yaml
evidence:
  files:
    - package.json
    - scripts/start-prod.mjs
    - server.ts
  symbols:
    - build
    - start
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - scripts/build-tier34.mjs
```

4. **Desktop release pipeline bundles tier34 into Tauri resources.** `beforeBuildCommand` runs `build:client && build:tier34`; resources include `../dist/` and `resources/node/`.

```yaml
evidence:
  files:
    - src-tauri/tauri.conf.json
    - scripts/build-tier34.mjs
  symbols:
    - beforeBuildCommand
    - build:tier34
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected: []
```

5. **Portable Node is downloaded only on Windows; failures exit 0.** Non-Windows skips; download errors warn and exit 0 so desktop asset prebuild does not hard-fail.

```yaml
evidence:
  files:
    - scripts/fetch-portable-node.mjs
    - package.json
  symbols:
    - prebuild:desktop:assets
    - NODE_VERSION
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

6. **Docker self-host uses unbundled tier34 source with `npx tsx`.** Image copies `tier34-server/` and runs `CMD ["npx", "tsx", "tier34-server/index.ts"]` — not `dist/tier34-server.mjs`.

```yaml
evidence:
  files:
    - Dockerfile.tier34
    - docker-compose.yml
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected:
    - scripts/build-tier34.mjs
```

7. **CI (`ci.yml`) and Release (`release.yml`) build web, Tauri (Linux + Windows), and Android artifacts on Node 22.** Release adds signed Android, F-Droid verify, and GitHub Release publish on `v*` tags.

```yaml
evidence:
  files:
    - .github/workflows/ci.yml
    - .github/workflows/release.yml
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected:
    - .github/workflows/phone-e2e-gate.yml
    - .github/workflows/nightly-e2e.yml
```

8. **Overlay remote-access stack requires multi-file compose; no repo script automates it.** `docker-compose.overlay.yml` documents manual `docker compose -f docker-compose.yml -f docker-compose.overlay.yml --env-file .env.overlay up -d`.

```yaml
evidence:
  files:
    - docker-compose.overlay.yml
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected:
    - overlay/headscale/config.example.yaml
```

9. **`fastlane/` contains metadata text only — no `Fastfile` or lane definitions in repo.**

```yaml
evidence:
  files:
    - fastlane/metadata/android/en-US/full_description.txt
    - fastlane/metadata/android/en-US/short_description.txt
  confidence: High
  evidence_type: filesystem_absence
counter_evidence:
  files_inspected:
    - fastlane/
```

10. **`tauri-build.mjs` pins `CARGO_TARGET_DIR` and verifies Windows NSIS artifacts when on win32.** Prevents sandbox redirect of cargo output; checks setup exe mtime vs `installer.nsi`.

```yaml
evidence:
  files:
    - scripts/tauri-build.mjs
  symbols:
    - verifyWindowsDesktopArtifacts
    - CARGO_TARGET_DIR
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

---

## Architectural Interpretation

The repository implements **multi-path deployment** without a central orchestrator. The audit name `spread-host.mjs` implies a script to propagate or package the Sandbox Server (tier34) host for installs; **that script is not implemented.** Host “spreading” in practice splits across:

| Path | Mechanism | Tier34 artifact |
|------|-----------|-----------------|
| Docker self-host | `docker compose up` + `Dockerfile.tier34` | Source tree + `tsx` |
| Desktop packaged | Tauri `beforeBuildCommand` + `build-tier34.mjs` | `dist/tier34-server.mjs` in bundle |
| Desktop runtime anchor | Tauri `local_server.rs` (Launcher subsystem) | Uses bundled or dev entry |
| Web/PWA prod | `npm run build` + `npm start` | **No tier34** in start path |
| Android | Capacitor sync of `dist/` only | Client points to user-configured remote URL |
| Remote overlay | Compose overlay + Caddy/Headscale/Tailscale | Extends Docker tier34 reachability |

**Deployment automation** (this pass) ends at **artifact and stack creation**. **Runtime host lifecycle** (start/stop/health) belongs to the Launcher subsystem. **Operator documentation** (`SELF_HOST.md`, `docs/overlay-network.md`) describes manual steps that are not encoded in `spread-host.mjs`.

```yaml
evidence:
  files:
    - SELF_HOST.md
    - docker-compose.yml
    - src-tauri/tauri.conf.json
    - docs/audit/launcher-analysis.md
  confidence: Medium
  evidence_type: cross_subsystem_boundary
counter_evidence:
  files_inspected:
    - docs/sandbox-architecture.md
  note: architecture doc partially stale on packaged tier34 claims per launcher-analysis
```

---

## Engineering Assessment

### Strengths

- **Mature CI matrix:** web, Tauri Linux/Windows, Android debug/release, E2E gates, tagged release publish.
- **Explicit platform guards:** `check-platform.mjs` before Android/Tauri builds.
- **F-Droid parity script:** `fdroid:local` mirrors documented prebuild for reproducibility checks.
- **Desktop bundle pipeline:** esbuild tier34 single-file + Tauri resource inclusion reduces runtime npm dependency on Windows when portable Node present.
- **Compose-based self-host:** single `docker compose up -d` for tier34 + Meilisearch baseline.
- **PWA size gate in CI:** prevents unbounded precache growth.

### Risks / gaps

| Risk | Severity | Basis |
|------|----------|-------|
| Missing `spread-host.mjs` / no unified deploy entry | **High** | Named subsystem absent; fragmented operator surface |
| `npm start` is UI-only full-stack gap | **High** | No tier34 in prod web start path |
| Docker vs desktop tier34 artifact divergence | **Medium** | `tsx` source in container vs esbuild `.mjs` in Tauri |
| Portable Node Windows-only | **High** on Linux/macOS desktop packages | `fetch-portable-node.mjs` skips non-win32 |
| Overlay deploy manual multi-step | **Medium** | No automation script; config copy + dual compose files |
| Release publish all-or-nothing | **Medium** | `publish.needs` blocks on any upstream job failure |
| `fetch-portable-node` fails open (exit 0) | **Medium** | Silent missing bundled Node on Windows prebuild failure |
| fastlane deploy path undocumented in code | **Low** | Metadata only; Play publish **Unknown** |

### Test / observability gaps (code-evident)

- No automated test that `build:desktop` output contains `tier34-server.mjs` in Tauri resource bundle.
- No CI job runs `docker compose up` smoke test against tier34 health.
- No script validates overlay stack end-to-end (Headscale + Tailscale + Caddy).
- spread-host orchestration behavior cannot be tested — module absent.

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
    - scripts/fetch-portable-node.mjs
    - .github/workflows/release.yml
    - .github/workflows/ci.yml
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - scripts/android-smoke-e2e.sh
  note: E2E tests app on emulator, not docker compose deploy
```

---

## Top 3 risks (summary)

1. **Absent central orchestrator (`spread-host.mjs`)** — deployment is scattered across npm, CI, and manual Docker/overlay steps; high operator confusion and no single audited deploy contract.
2. **Full-stack prod gap on web path** — `npm run build` + `npm start` deploys UI server only; tier34/Meilisearch require separate Docker or `dev:tier34` manual ops.
3. **Cross-platform desktop Node bundling gap** — Windows fetches portable Node; Linux/macOS Tauri releases depend on system Node without in-repo fetch equivalent, while `build-tier34.mjs` still produces the sidecar bundle.

```yaml
evidence:
  files:
    - scripts/spread-host.mjs
    - scripts/start-prod.mjs
    - scripts/fetch-portable-node.mjs
    - package.json
  confidence: High
  evidence_type:
    - filesystem_absence
    - implementation
counter_evidence:
  files_inspected: []
```
