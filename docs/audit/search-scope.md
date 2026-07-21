# Pass 1 — Search Scope

Inventory scan performed **2026-07-21** for workspace `C:\Users\RH\Downloads\sovereign-music-console`. This document defines what was in scope for Pass 1 (Inventory) only. No subsystem analysis was performed.

## Directories searched

| Path | Purpose in scan |
|------|-----------------|
| `/` (repo root) | Top-level layout, root `*.md`, `package.json`, compose files, Dockerfiles |
| `docs/` | All project documentation (`*.md`) |
| `docs/audit/` | Audit artifact output (created during this pass) |
| `src/` | Client module layout, import graph sampling, `*.ts` / `*.tsx` file counts |
| `tier34-server/` | Sandbox Server backend layout (`index.ts`, `lib/`, `routes/`) |
| `server.ts` | UI dev/prod Express + Vite server entry |
| `scripts/` | Build/deploy scripts and `INSTALL-RULES.md` |
| `public/` | Static assets and addon README |
| `android/` | Gradle configs, `variables.gradle`, `app/build.gradle` (not full Java tree) |
| `src-tauri/` | `Cargo.toml`, crate layout |
| `config/` | Deployment adjunct configs |
| `docker/` | Sidecar service definitions |
| `metadata/` | F-Droid submission templates |
| `overlay/` | Headscale/Tailscale/Caddy overlay stack |
| `fastlane/` | Play Store listing text |
| `assets/` | Branding assets |
| `.cursor/rules/` | Workspace Cursor rules (`*.mdc`) |
| `.github/workflows/` | CI workflow filenames (no markdown docs found) |

## Files searched (representative)

- All `**/*.{md,mdc}` under the directories above (see exclusions)
- `package.json`, `package-lock.json` (root only)
- `capacitor.config.ts`, `vite.config.ts`, `tsconfig.json`
- `docker-compose.yml`, `docker-compose.overlay.yml`, `docker-compose.soulseek.yml`
- `Dockerfile.tier34`, `Dockerfile.demucs`
- `android/build.gradle`, `android/variables.gradle`, `android/app/build.gradle`
- `src-tauri/Cargo.toml`
- `tier34-server/index.ts` (header + import block)
- `LICENSE` (presence only; GPL text not summarized)

## Files and directories excluded

| Exclusion | Reason |
|-----------|--------|
| `node_modules/**` | Third-party packages; documented via root `package.json` only |
| `dist/**` | Vite build output; regenerated, not source of truth |
| `android/app/build/**`, `android/build/**` | Gradle intermediates and packaged web assets |
| `android/app/src/main/assets/public/**` | Capacitor sync copy of `dist/` |
| `src-tauri/target/**` | Rust/Tauri build artifacts |
| `.git/**` | Version control metadata |
| `.idea/**` | IDE-local settings |
| `.jdk21/**` | Local JDK install cache |
| `proof-screenshots/**`, `proof-oneplus-46349770/**` | Manual QA captures and log dumps; not architectural docs |
| `_apk_check/**` | Ad-hoc APK investigation scratch |
| `node_modules/**/README.md` and similar | Vendor documentation; out of project doc inventory |
| Duplicate `README.md` under `dist/`, `android/.../assets/`, `src-tauri/target/` | Build copies of `public/addons/record-player/README.md` |
| Full Java/Kotlin source walk | Pass 1 scope: Gradle dependency declarations only for Android |
| Runtime `tier34-server/storage/**` | Local server data, quarantine blobs, generated indexes |
| Binary/media (`*.png`, `*.apk`, `*.db`, `*.dex`, etc.) | Not documentation |

## Scan methods

1. Top-level directory listing (`Get-ChildItem`, `dir /b`)
2. Glob `**/*.{md,mdc}` scoped to project paths (excluding vendor/build paths manually)
3. Read `package.json`, `Cargo.toml`, Gradle files, key config headers
4. Grep import patterns in `src/` and `tier34-server/` for internal dependency edges
5. First-line / heading extraction from all `docs/*.md` files

## Out of scope for Pass 1

- Subsystem behavior analysis
- API endpoint catalog
- Test coverage mapping
- Dead-code detection beyond top-level directory classification
- Content accuracy review of existing documentation
