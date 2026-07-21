# Pass 2 — Node.js Station Launcher & Daemon Analysis

Subsystem: **Node.js Station Launcher & Daemon** — processes and scripts that launch the Sandbox Server (`tier34-server`, default port **3001**) as a child or standalone Node daemon. **Code-only audit — 2026-07-21.**

---

## Subsystem boundary

| In scope | Role |
|----------|------|
| `src-tauri/src/local_server.rs` | Tauri-managed `Child` spawn/kill/monitor for tier34 |
| `src-tauri/src/commands.rs` | Tauri IPC: `start_local_server`, `stop_local_server`, `local_server_managed_running` |
| `src/sandboxServerBridge.ts` | Client bridge: start/stop, health wait, auto-start, playback ensure |
| `src/sandboxSettings.ts` (server mode / auto-start / backend URL sync) | Anchor vs remote/off; auto-start default; `sandbox_tier34_backend_url` sync |
| `src/components/ServerDiscovery.tsx` | Settings/onboarding Start/Stop UI |
| `src/sandboxLayer3.tsx` | Shell mount auto-start; playback-time `ensureTier34ForPlayback` |
| `scripts/build-tier34.mjs`, `scripts/fetch-portable-node.mjs` | Desktop bundle: esbuild tier34 + optional portable Node (Windows) |
| `package.json` scripts | Dev/prod launch: `dev:tier34`, `dev:all`, `start:tier34`, `start` (UI only) |
| `tier34-server/index.ts` (process entry + `/health` + `listen`) | Daemon target being launched |
| `Dockerfile.tier34`, `docker-compose.yml` (`tier34` service) | Container launcher (orthogonal to Tauri) |

| Out of scope | Reason |
|--------------|--------|
| `tier34-server/lib/*`, `routes/*` (beyond listen/health) | Backend business logic — separate subsystem |
| `server.ts` | UI server (:3002); Tauri `devUrl` dependency, not tier34 launcher |
| `src-tauri/src/cast_browser_server.rs` | Separate localhost static server for cast browser |
| `src/stations/*` (feature views) | UI “stations”, not server launcher |
| `overlay/` | HTTP/3 reverse proxy to already-running tier34 |

**Entry points (all verified):**

1. **Desktop anchor (primary):** Tauri `start_local_server` → `local_server::spawn_tier34`
2. **Dev CLI:** `npm run dev:tier34` / `start:tier34` → `tsx tier34-server/index.ts`
3. **Dev full stack:** `npm run dev:all` → `concurrently` UI + tier34
4. **Docker:** `docker compose up tier34` → `Dockerfile.tier34` CMD
5. **Production UI only:** `npm start` → `scripts/start-prod.mjs` → `dist/server.cjs` (does **not** start tier34)

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - package.json
    - Dockerfile.tier34
    - scripts/start-prod.mjs
  symbols:
    - spawn_tier34
    - dev:tier34
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - overlay/caddy/Caddyfile
```

---

## Subsystem Interface

### Inputs

| Input | Source | Handler |
|-------|--------|---------|
| User Start/Stop (Settings Vault) | `ServerDiscovery.tsx` | `startLocalSandboxServer` / `stopLocalSandboxServer` → Tauri invoke |
| Shell mount auto-start | `sandboxLayer3.tsx` `useEffect` | `maybeAutoStartLocalSandboxServer()` |
| Playback resolve (anchor desktop) | `sandboxLayer3.tsx` `handlePlayEnvelope` path | `ensureTier34ForPlayback({ onPhase })` |
| Tauri app exit | `lib.rs` `RunEvent::Exit` | `stop_local_server` |
| Dev operator | shell | `npm run dev:tier34`, `dev:all`, `start:tier34` |
| Container orchestrator | Docker | `CMD ["npx", "tsx", "tier34-server/index.ts"]` |
| Env overrides | OS / compose | `SANDBOX_TIER34_ROOT`, `SANDBOX_TIER34_RESOURCE`, `TIER34_PORT`, `TIER34_CORS_ORIGIN`, `TIER34_STORAGE_PATH` |

### Outputs

| Output | Consumer |
|--------|----------|
| Listening HTTP + WS on `0.0.0.0:3001` | `src/tier34/client.ts`, mobile/desktop clients |
| `GET /health` JSON `{ ok: true, ... }` | `tier34HealthOk`, `ServerDiscovery` health chips |
| Managed-child boolean | `local_server_managed_running` → UI state |
| `Tier34StartPhase` callbacks | Playback toasts (`starting` / `waiting` / `ready` / `failed`) |
| Bundled artifacts `dist/tier34-server.mjs`, optional `resources/node/node.exe` | Tauri resource bundle |

### State changes

- **Rust:** `LocalServerState.child: Option<Child>` — set on start, cleared on exit/kill/`try_wait` Some
- **Client prefs:** `sandbox_server_mode`, `sandbox_server_auto_start`, `sandbox_tier34_backend_url` (synced on mode change)
- **Ephemeral:** `lastTier34StartError` in `sandboxServerBridge.ts`; tier34 reachability cache in `tier34/client.ts`
- **Daemon boot:** job worker init, media graph backfill, podcast schedulers, ingestion watcher (inside tier34 process after `listen`)

### External dependencies

| Dependency | Role |
|------------|------|
| Node.js runtime | Execute bundled `.mjs`, `tsx`, or Docker `npx tsx` |
| `tsx` / `npx` | Dev and Docker tier34 entry (non-bundled path) |
| `kill-port` | Dev script port cleanup only |
| `concurrently` | Parallel UI + tier34 in `dev:all` |
| `esbuild` | `build:tier34` single-file bundle |
| Tauri 2 + `parking_lot::Mutex` | IPC and child-process state |
| Express + `ws` (in tier34 bundle) | Daemon HTTP/WebSocket server |
| Optional: Meilisearch, yt-dlp, etc. | Reported in `/health`; not required for process bind |

### Called by

- `sandboxLayer3.tsx` (auto-start, playback ensure)
- `ServerDiscovery.tsx` (manual Start/Stop)
- Tauri desktop shell lifecycle (`RunEvent::Exit`)
- Developers / CI via npm and Docker
- `tauri.conf.json` `beforeBuildCommand` indirectly (`build:tier34`)

### Calls into

- `std::process::Command::spawn` / `Child::kill` (`local_server.rs`)
- `@tauri-apps/api/core` `invoke('start_local_server' | 'stop_local_server' | 'local_server_managed_running')`
- `tier34HealthOk` → `fetch` `GET {base}/health`
- Child executes `node tier34-server.mjs` **or** `npx tsx tier34-server/index.ts`

### Persistence

- **Launcher state:** in-memory only (`LocalServerState`); not persisted across app restarts
- **User prefs:** `prefsStorage` keys for mode, auto-start, backend URL
- **Tier34 data:** filesystem under `TIER34_STORAGE_PATH` or default `lockerPaths` resolution (daemon responsibility)
- **No** systemd/pm2 integration in repo

### Threading / async behaviour

- **Rust:** synchronous spawn/kill on Tauri command thread; `parking_lot::Mutex` guards child handle
- **Client:** `waitForTier34Health` async poll loop (400ms interval, 20s default deadline); `maybeAutoStartLocalSandboxServer` fire-and-forget from `useEffect`
- **Spawned child:** stdio `null` — no log piping to parent
- **Tier34 daemon:** single Node event loop; `httpServer.listen` callback boots workers/schedulers sequentially with try/catch
- **Dev `start-prod.mjs`:** detached-style `spawn(process.execPath, [server])` without awaiting exit (UI server only)

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - src/sandboxServerBridge.ts
    - src/tier34/client.ts
    - tier34-server/index.ts
    - scripts/start-prod.mjs
  symbols:
    - waitForTier34Health
    - start_local_server
    - httpServer.listen
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - src-tauri/src/cast_browser_server.rs
```

---

## Verified Facts

1. **Tauri is the only in-app launcher for tier34.** `local_server.rs` spawns a single `Child`, tracks it in `LocalServerState`, and exposes three commands registered in `lib.rs`.

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - src-tauri/src/lib.rs
    - src-tauri/src/commands.rs
  symbols:
    - LocalServerState
    - start_local_server
    - stop_local_server
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - src/capacitor.config.ts
```

2. **Two spawn strategies exist, with bundled entry preferred.** If `tier34-server.mjs` or `.cjs` is found under resource/install paths, `spawn_tier34_bundled` runs `{node} {entry}` with `current_dir` = entry parent. Otherwise dev path runs `npx tsx tier34-server/index.ts` from project root (Windows via `cmd /C`).

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - scripts/build-tier34.mjs
  symbols:
    - bundled_tier34_entry
    - spawn_tier34_bundled
    - spawn_tier34
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

3. **Desktop release pipeline bundles tier34 into `dist/tier34-server.mjs`.** `tauri.conf.json` `beforeBuildCommand` runs `build:client && build:tier34`; bundle `resources` includes `../dist/` and `resources/node/`.

```yaml
evidence:
  files:
    - src-tauri/tauri.conf.json
    - scripts/build-tier34.mjs
    - package.json
  symbols:
    - build:tier34
    - beforeBuildCommand
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected:
    - docs/sandbox-architecture.md
  note: architecture doc states packaged installs do not bundle tier34 — contradicts current build config
```

4. **Portable Node is fetched only on Windows** (`node-v22.16.0-win-x64` → `src-tauri/resources/node/node.exe`). Non-Windows `prebuild:desktop:assets` skips fetch; spawn falls back to `node` / `node.exe` on PATH.

```yaml
evidence:
  files:
    - scripts/fetch-portable-node.mjs
    - src-tauri/src/local_server.rs
  symbols:
    - bundled_node_executable
    - resolve_node_executable
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

5. **Client bridge gates all desktop spawn paths on Tauri and anchor mode** (except manual Start in UI which still requires desktop). Health gating uses `tier34HealthOk()` → `/health` with 3s fetch timeout.

```yaml
evidence:
  files:
    - src/sandboxServerBridge.ts
    - src/sandboxSettings.ts
    - src/tier34/client.ts
    - src/platformEnv.ts
  symbols:
    - maybeAutoStartLocalSandboxServer
    - ensureTier34ForPlayback
    - tier34HealthOk
    - canHostSandboxServerAnchor
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

6. **Auto-start fires once on shell mount** (`sandboxLayer3.tsx` `useEffect` → `maybeAutoStartLocalSandboxServer`). Default auto-start is **true** when pref unset and mode is anchor.

```yaml
evidence:
  files:
    - src/sandboxLayer3.tsx
    - src/sandboxSettings.ts
  symbols:
    - maybeAutoStartLocalSandboxServer
    - loadSandboxServerAutoStart
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

7. **Spawned children have stdin/stdout/stderr nulled** — launcher cannot surface tier34 console errors to UI except via health probe failure.

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
  symbols:
    - spawn_tier34_bundled
    - Stdio::null
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```

8. **Dev tier34 scripts kill port 3001 before start; Tauri launcher does not.** `kill-port` appears only in `dev:tier34` / `dev:tier34:restart`.

```yaml
evidence:
  files:
    - package.json
    - src-tauri/src/local_server.rs
  symbols:
    - dev:tier34
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected: []
```

9. **Docker tier34 is a separate launcher path:** image runs `npx tsx tier34-server/index.ts`; compose sets storage, CORS, Meilisearch URL, tmpfs cache.

```yaml
evidence:
  files:
    - Dockerfile.tier34
    - docker-compose.yml
  confidence: High
  evidence_type: configuration
counter_evidence:
  files_inspected: []
```

10. **Default locker storage path depends on bundled module location.** `lockerPaths.ts` uses `join(__dirname, '..', 'storage')`; esbuild bundle changes `__dirname` relative to `dist/tier34-server.mjs` vs dev `tier34-server/lib`.

```yaml
evidence:
  files:
    - tier34-server/lib/lockerPaths.ts
    - scripts/build-tier34.mjs
    - src-tauri/src/local_server.rs
  symbols:
    - LOCKER_STORAGE_ROOT
    - DEFAULT_STORAGE_ROOT
  confidence: Medium
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - dist/tier34-server.mjs
  note: bundled file present in build output but runtime path resolution not executed in this audit
```

---

## Architectural Interpretation

The subsystem implements a **desktop sidecar pattern**: the Tauri shell remains the lifecycle owner of an optional Node daemon that exposes the Sandbox Server API on loopback (`127.0.0.1:3001` per `SANDBOX_SERVER_ANCHOR_URL`). The UI server on port 3002 (Vite dev or static `dist/`) is a **separate process** started by `npm run dev` / `start-prod.mjs` and is only coupled via `tauri.conf.json` `devUrl` and CSP `connect-src` to localhost:3001.

Launch orchestration splits into **three deployment classes**:

| Class | Launcher | Tier34 artifact | Node source |
|-------|----------|-----------------|-------------|
| Tauri packaged | `local_server.rs` | `tier34-server.mjs` in resources/dist | Bundled `node.exe` (Win) or PATH |
| Tauri dev / git checkout | `local_server.rs` or manual `dev:tier34` | `tier34-server/index.ts` via tsx | Developer PATH + npx |
| Docker self-host | container CMD | source tree in image | image `node:22` |

Client-side, **mode settings and process management are loosely coupled**: `sandbox_server_mode` controls whether auto-start/spawn is attempted, while `syncTier34BackendUrlFromServerMode` aligns `sandbox_tier34_backend_url` for HTTP clients. Health success is the authoritative “daemon ready” signal, not the return value of `start_local_server` alone.

```yaml
evidence:
  files:
    - src/sandboxSettings.ts
    - src/sandboxServerBridge.ts
    - server.ts
    - src-tauri/tauri.conf.json
  symbols:
    - syncTier34BackendUrlFromServerMode
    - SANDBOX_SERVER_ANCHOR_URL
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - TIER34.md
  note: operator doc not re-validated line-by-line in Pass 2
```

---

## Engineering Assessment

### Strengths

- **Clear ownership boundary:** single Rust module owns child PID; app exit stops managed server.
- **Packaged path exists:** esbuild bundle + Tauri resource inclusion removes tsx/npm dependency on Windows when portable Node is present.
- **Idempotent start guard:** prevents duplicate managed spawns from UI double-clicks.
- **Health-based readiness:** aligns UI with actual bind/listen, not just spawn success.
- **Explicit env injection** for port and CORS on every spawn path in `local_server.rs`.

### Risks / gaps

| Risk | Severity | Basis |
|------|----------|-------|
| Silent tier34 failures (nulled stdio) | **High** | Operators see health timeout only; no log tail to Settings UI |
| Port 3001 conflict with external/manual tier34 | **High** | Tauri launcher does not `kill-port`; `start_local_server` may succeed at OS level or fail opaquely while health never passes |
| Linux/macOS packaged anchor without system Node | **High** | `fetch-portable-node.mjs` is Windows-only; non-Windows bundles lack `resources/node` |
| Storage path divergence dev vs bundled | **Medium–High** | `lockerPaths` `__dirname` semantics differ when single-file bundled; `TIER34_STORAGE_PATH` not set by launcher |
| Documentation drift | **Medium** | `docs/sandbox-architecture.md` claims packaged installs lack tier34 bundle; code bundles `tier34-server.mjs` |
| `npm start` does not launch tier34 | **Medium** | Web prod path is UI-only; operators may assume full stack |
| Orphan tier34 on parent crash | **Low–Medium** | Only graceful `RunEvent::Exit` stops child |

### Test / observability gaps (code-evident)

- No automated tests for `local_server.rs` spawn resolution or bundled-vs-dev path selection.
- No in-repo systemd/pm2/supervisor unit for bare-metal tier34 (Docker only).
- `local_server_managed_running` reports managed child only — not health of external tier34 on same port.

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - docs/sandbox-architecture.md
    - scripts/fetch-portable-node.mjs
    - package.json
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected:
    - tier34-server/lib/sandboxIndexer.test.ts
  note: tier34 has unit tests but not launcher integration tests
```

---

## Top 3 risks (summary)

1. **Silent failure + health-only feedback** — stdio discarded; slow/failed binds surface only as `waitForTier34Health` timeout or `getLastTier34StartError` from spawn errors.
2. **Port 3001 / dual-instance contention** — dev scripts kill port; Tauri anchor launcher does not; external tier34 vs managed child can desync health and storage.
3. **Cross-platform packaged Node gap** — Windows bundles portable Node; Linux/macOS packaged anchor relies on system Node and PATH, with no in-repo fetch equivalent.

```yaml
evidence:
  files:
    - src-tauri/src/local_server.rs
    - src/sandboxServerBridge.ts
    - scripts/fetch-portable-node.mjs
    - package.json
  confidence: High
  evidence_type: implementation
counter_evidence:
  files_inspected: []
```
