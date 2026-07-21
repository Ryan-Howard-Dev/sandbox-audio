# Self-hosting Sovereign Music Console

Run the Tier 3/4 backend and Meilisearch together for locker sync, catalog acquisition, and full-text locker search.

## Quick start (Docker)

```bash
# From repo root — requires Docker Desktop or Docker Engine
docker compose up -d

# UI dev server (separate terminal)
npm install
npm run dev
```

Open the app at `http://localhost:3002` (Vite dev server). In **Settings → Playback Engine**, set the Tier 3/4 backend URL to `http://localhost:3001`.

## Services

| Service | Port | Role |
|---------|------|------|
| **tier34** | 3001 | Locker blobs, acquire worker, media graph, search proxy |
| **meilisearch** | 7700 | Locker full-text index (optional but recommended) |
| **UI** (`npm run dev`) | 3002 | React shell |

## Without Docker

```bash
# Terminal 1 — Meilisearch (optional)
docker run -d -p 7700:7700 getmeili/meilisearch:v1.12

# Terminal 2 — Tier34
npm run dev:tier34

# Terminal 3 — UI
npm run dev
```

Or use `npm run dev:all` to start UI + tier34 together (Meilisearch still separate).

## Environment

Copy `.env.example` to `.env` and adjust:

- `TIER34_PORT` — backend port (default 3001)
- `MEILISEARCH_URL` — tier34 reads this (default `http://localhost:7700`)
- `TIER34_STORAGE_PATH` — blob storage root on the tier34 host
- `TIER34_CORS_ORIGIN` — UI origin allowed for API calls

## Locker sync

1. **Settings → Device Capacity → Cross-device locker sync**
2. Provider: **Self-hosted Tier 3/4** (full mode) or **WebDAV**
3. WebDAV: embed credentials in URL if needed (`https://user:pass@host/dav/`)
4. Use **Sync this album** checkboxes in Locker → Albums for selective pull

## Search reindex

After bulk imports, open **Settings → Playback Engine** or **Signal Bench** and click **Reindex locker search**, or:

```bash
curl -X POST http://localhost:3001/api/search/reindex
```

## Sandbox Cast

Locker `blob:` URLs are resolved to `http://<tier34>/api/locker/blob/{hash}` when casting. Ensure tier34 is reachable from your Sandbox Cast receiver on the LAN (not `localhost` from the TV's perspective — use your machine's LAN IP in Settings).

## DLNA MediaServer

Expose the locker to TVs and receivers as a UPnP MediaServer (browse + play without the app):

```bash
# .env on tier34 host
DLNA_MEDIASERVER=1
DLNA_BASE_URL=http://192.168.1.42:3001   # your LAN IP — required for TVs
```

Restart `npm run dev:tier34`, then open **Music / DLNA** on your TV. Full guide: [docs/dlna-mediaserver.md](./docs/dlna-mediaserver.md).

**Windows:** allow tier34 through the firewall (TCP 3001, UDP 1900 SSDP). Disable guest Wi‑Fi isolation if devices cannot see each other.

## Notes

- **S3** blob sync is documented for future use; WebDAV and Tier34 are implemented today.
- **Tauri** desktop builds do not include `tauri-plugin-dialog`; enter ingestion watch paths manually or via `.env`.
- Production hardening (TLS, auth, firewall) is left to the operator.

See also: [TIER34.md](./TIER34.md), [LOCKER_SYNC.md](./LOCKER_SYNC.md).
