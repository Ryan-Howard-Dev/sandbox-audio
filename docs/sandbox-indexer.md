# Sandbox Indexer

Built-in **Prowlarr-lite** inside the Sandbox Server (tier34). Replaces the requirement to run external Prowlarr for basic search and acquire flows.

## What works without Prowlarr

| Source | Tier | Notes |
|--------|------|-------|
| **Archive.org** | Debrid / proxy | FLAC-biased search for lossless acquire; direct HTTP download |
| **yt-dlp** | Proxy | YouTube metadata search when `yt-dlp` is installed on the server host |
| **iTunes previews** | Proxy | 30s catalog previews via existing proxy tier (not full acquire) |
| **Direct magnet / `.torrent` URL** | Debrid | Paste into search or `/api/indexer/resolve-link` with Real-Debrid key |

**Acquire without Prowlarr:** Start Sandbox Server (`npm run dev:tier34`), set Server URL in Settings → Addons, use **Best** or **Proxy** tier — yt-dlp + Archive.org resolve automatically. **Debrid** tier falls back to Archive.org FLAC without any external indexer.

## Optional upgrades (power users)

| Source | When needed |
|--------|-------------|
| **Torznab / Jackett** | User-provided self-hosted endpoints in Settings → Addons → Sandbox Indexer → Torznab advanced |
| **Prowlarr** | Private trackers / full indexer catalog — Settings → Addons → Show acquisition keys → External indexer |
| **Real-Debrid** | Unrestrict magnets from Torznab/Prowlarr/direct paste — not required for Archive.org direct downloads |

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/indexer/search?q=artist+track` | Unified results from all configured sources |
| `GET` | `/api/indexer/status` | Built-in source availability + Torznab endpoint count |
| `POST` | `/api/indexer/configure` | `{ "torznabEndpoints": [{ "name", "url", "apiKey?" }] }` |
| `POST` | `/api/indexer/resolve-link` | `{ "link": "magnet:..." }` → Real-Debrid unrestrict when RD key set |

Config is stored server-side at `{TIER34_STORAGE_PATH}/indexer-config.json`.

## What still needs an external indexer

- Private tracker torrents (RED, OPS, etc.)
- Broad public tracker coverage beyond what your Jackett instance indexes
- Podcast-specific indexers that only exist in Prowlarr

Sandbox Indexer does **not** scrape arbitrary torrent sites. Use your own Jackett/Prowlarr instance for those indexers.

## Windows manual test

1. `npm run dev:tier34` — confirm `/health` shows `ytdlp` and feature `sandbox-indexer`.
2. Open app → Settings → Addons → set Server URL `http://localhost:3001`.
3. Confirm **Sandbox Indexer** section lists `archive.org` (+ `yt-dlp` if installed).
4. Click **Test Sandbox Indexer** — expect `Built-in: archive.org, yt-dlp`.
5. Search a track → play or acquire with **Best** tier (no Prowlarr keys).
6. Optional: add Real-Debrid key only → acquire debrid tier should hit Archive.org FLAC.
7. Optional: configure Jackett Torznab URL in advanced section → search should include torrent hits.
8. Optional: set Prowlarr URL + API key under acquisition keys → external indexer test + torrent resolve via RD.
