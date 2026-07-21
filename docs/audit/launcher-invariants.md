# Pass 2 — Node.js Station Launcher & Daemon Invariants

Subsystem scope: mechanisms that **start, stop, package, and health-gate** the Sandbox Server (`tier34-server`, port **3001**) — Tauri child-process launcher (`src-tauri/src/local_server.rs`), client bridge (`src/sandboxServerBridge.ts`), anchor/auto-start settings, dev npm scripts, desktop bundle pipeline, and container entry (`Dockerfile.tier34`). **Code-only audit — 2026-07-21.**

**Out of scope:** tier34 route handlers, workers, locker graph logic; UI server (`server.ts`, port 3002); Android/Capacitor app launch; overlay reverse-proxy config.

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| At most one Tauri-managed tier34 child may be tracked in `LocalServerState` | Double spawn wastes port 3001, leaks processes, and breaks Start/Stop semantics | `start_local_server` returns `"Sandbox Server is already running"` when `try_wait()` is `Ok(None)`; single `child: Mutex<Option<Child>>` | **Medium** — external tier34 on 3001 is not detected; spawn may fail with EADDRINUSE while managed state stays empty |
| Anchor sidecar spawn is Tauri-desktop-only | Mobile/web must not fork Node on device | `canHostSandboxServerAnchor()` → `isTauri()`; `sandboxServerBridge` throws `desktop-only` off Tauri | **Low** — mis-detection of Tauri globals would block or allow wrongly |
| Auto-start runs only when mode is `anchor` and auto-start pref is true | Prevents unwanted Node fork in remote/off modes | `maybeAutoStartLocalSandboxServer`: checks `loadSandboxServerAutoStart()`, `loadSandboxServerMode() === 'anchor'`, skips if `tier34HealthOk()` | **Medium** — default auto-start is true when mode is anchor and key unset (`loadSandboxServerAutoStart`) |
| Playback-triggered start (`ensureTier34ForPlayback`) requires anchor mode on desktop | Catalog resolve should not spawn server when user chose remote/off | `ensureTier34ForPlayback`: returns false unless `isSandboxServerDesktop()` and `loadSandboxServerMode() === 'anchor'` | **Low** |
| Spawned tier34 must listen on port 3001 with CORS origin `http://localhost:3002` | Client anchor URL and UI dev server CSP expect fixed pairing | `spawn_tier34` / `spawn_tier34_bundled` set `TIER34_PORT=3001`, `TIER34_CORS_ORIGIN=http://localhost:3002` | **High** — env override in shell or conflicting external tier34 breaks health/sync |
| Packaged spawn prefers bundled `tier34-server.mjs` over dev `npx tsx` tree | Release must not require npm/tsx on end-user machines | `spawn_tier34` calls `bundled_tier34_entry()` first; `build:tier34` writes `dist/tier34-server.mjs`; Tauri bundles `../dist/` | **Medium** — missing bundle artifact falls through to dev path and fails on clean installs |
| Readiness is determined by HTTP `GET /health` with `{ ok: true }`, not child PID alone | Process may exit or hang before bind; UI must not mark ready early | `waitForTier34Health` polls `tier34HealthOk()` (3s timeout per probe); tier34 exposes `/health` returning `ok: true` | **High** — 20s default wait may expire on slow boot; stderr is discarded so bind errors are invisible |
| App exit must stop managed tier34 child | Avoid orphan Node daemons after closing desktop app | `lib.rs` `RunEvent::Exit` → `stop_local_server`; `stop_local_server` calls `child.kill()` + `wait()` | **Medium** — crash/kill -9 on parent may orphan child; externally started tier34 unaffected |
| `SANDBOX_TIER34_RESOURCE` is set from Tauri resource dir at setup | Bundled node + tier34 artifacts resolve relative to install layout | `lib.rs` setup: `set_var("SANDBOX_TIER34_RESOURCE", resource_dir)`; `bundled_tier34_entry` / `bundled_node_executable` search under resource paths | **Medium** — dev builds without resource dir rely on cwd / `SANDBOX_TIER34_ROOT` heuristics |
| Dev restart scripts must free port 3001 before relaunch | Prevents stale tier34 blocking `dev:tier34` | `package.json` `dev:tier34`: `kill-port 3001 && tsx tier34-server/index.ts` | **Low** — Tauri launcher does not run `kill-port`; manual/external servers can block anchor start |
| Default locker storage path is derived from module `__dirname`, not `process.cwd()` | Wrong bundle layout shifts on-disk locker location | `lockerPaths.ts`: `DEFAULT_STORAGE_ROOT = join(__dirname, '..', 'storage')`; bundled entry runs with `current_dir(work_dir)` = `dist/` parent | **High** — packaged `tier34-server.mjs` resolves storage to `{project_or_dist_parent}/storage` vs dev `tier34-server/storage` unless `TIER34_STORAGE_PATH` set |
| Docker tier34 uses `npx tsx tier34-server/index.ts` with explicit `TIER34_PORT` | Container CMD is alternate launcher path (not Tauri) | `Dockerfile.tier34` CMD; compose sets `TIER34_STORAGE_PATH`, `TIER34_PORT` | **Low** — differs from desktop bundled `.mjs` path by design |
| Portable Node bundle step is Windows-only | Non-Windows packaged installs depend on system `node` on PATH | `fetch-portable-node.mjs` exits 0 on non-win32; only fetches `node.exe` into `src-tauri/resources/node/` | **High** on Linux/macOS desktop — anchor spawn may fail without system Node even when bundle exists |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/commands.rs
    - src/sandboxServerBridge.ts
    - src/sandboxSettings.ts
    - src/platformEnv.ts
    - src/sandboxLayer3.tsx
    - src/components/ServerDiscovery.tsx
    - scripts/build-tier34.mjs
    - scripts/fetch-portable-node.mjs
    - package.json
    - tier34-server/index.ts
    - tier34-server/lib/lockerPaths.ts
    - Dockerfile.tier34
    - docker-compose.yml
    - src-tauri/tauri.conf.json
  symbols:
    - start_local_server
    - stop_local_server
    - spawn_tier34
    - maybeAutoStartLocalSandboxServer
    - waitForTier34Health
    - tier34HealthOk
  confidence: High
  evidence_type:
    - implementation
    - configuration
counter_evidence:
  files_inspected:
    - overlay/caddy/Caddyfile
    - scripts/generate-android-launcher-icons.py
  note: overlay proxies existing tier34; Android launcher icons unrelated to Node daemon
```
