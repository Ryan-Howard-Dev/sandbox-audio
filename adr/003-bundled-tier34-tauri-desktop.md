# ADR 003: Tauri desktop bundles tier34 as a sidecar artifact

## Status

Accepted

## Context

Sandbox Server (tier34) is the self-hosted Node/Express API on port **3001** for acquire, locker sync, search proxy, Connect, and related features. Deployment and launcher audits document **two tier34 artifact shapes**:

1. **Packaged desktop:** esbuild bundle `dist/tier34-server.mjs` included in Tauri resources; spawn via `node tier34-server.mjs`.
2. **Docker self-host:** source tree + `npx tsx tier34-server/index.ts` in container.

Pass 2 launcher audit notes `docs/sandbox-architecture.md` incorrectly states packaged installs do not bundle tier34 — Pass 3 documentation drift confirms this. Current build config (`tauri.conf.json` `beforeBuildCommand`) runs `build:tier34` and bundles `../dist/`.

Anchor mode on desktop auto-starts tier34 via Tauri `local_server.rs` when mode is `anchor` and health check passes.

## Decision

**Tauri desktop release builds bundle the tier34 sidecar** as `dist/tier34-server.mjs` (plus optional portable `node.exe` on Windows).

- `beforeBuildCommand`: `npm run build:client && npm run build:tier34`
- Tauri `bundle.resources` includes `../dist/` and `resources/node/`
- Spawn prefers bundled entry (`bundled_tier34_entry`) over dev `npx tsx tier34-server/index.ts`
- Portable Node fetch (`fetch-portable-node.mjs`) runs **Windows only**; Linux/macOS rely on system `node` on PATH
- `npm start` / `start-prod.mjs` launches **UI server only** — does not start tier34

Android/Capacitor ships `dist/` web client only; phones must configure a LAN tier34 URL.

## Consequences

### Positive

- Windows packaged installs can run anchor mode without developer Node/tsx on PATH (when portable Node present).
- Single-file esbuild bundle reduces runtime npm dependency for end users.
- Health-gated readiness (`GET /health`) aligns UI with actual bind.

### Negative

- Linux/macOS packaged anchor may fail without system Node (no bundled portable Node).
- Docker and desktop use different tier34 artifacts — behavior/path divergence (`lockerPaths` `__dirname` semantics).
- Spawned child stdio is nulled — silent failures until health timeout.
- Operator docs (`sandbox-architecture.md`) partially stale on bundled tier34 claims.

## Evidence

- `docs/audit/launcher-analysis.md` — Verified Facts §2–3 (bundled spawn, Tauri resources), §4 (Windows-only portable Node)
- `docs/audit/launcher-invariants.md` — packaged spawn, portable Node, storage path rows
- `docs/audit/deployment-analysis.md` — Verified Facts §4 (beforeBuildCommand), §6 (Docker vs bundle)
- `docs/audit/deployment-invariants.md` — `build:tier34`, portable Node, `npm start` UI-only rows
- `docs/audit/documentation-drift.md` — Confirmed drift on "tier34 not embedded"
