# Addon URLs — Testing Workflow

Short answer: **test your addon URLs now in the browser. Do not put them in the public repo or release build.**

Related: [README.md](./README.md) (architecture), [TIER34.md](./TIER34.md) (tier 3/4 backend for tier-3/4 manifests).

---

## How addons work

| Layer | File | Role |
|-------|------|------|
| Storage | `src/addonStorage.ts` | Persists installed addons in localStorage (`sandbox_installed_addons`); merges the built-in dev-test pack on every app start. |
| Search resolve | `src/addons/searchProviders.ts` | `searchUserManifestAddons()` + `searchBuiltinPackAddons()`; builtins need experimental toggle. |
| Playback resolve | `src/playbackPipeline.ts` | `executeTrack()` races tier 3/4, then user manifests (always), then builtins (experimental). |

**User-installed manifest addons** (pasted in Settings → Addons) are **live**: search and playback both flow through `searchProviders.ts` → `playbackPipeline.ts` — **no experimental toggle required**.

**Built-in dev-test pack** (SoundCloud, WebTorrent, IPFS, Radio Browser, Audius, Soulseek) are wired to tier34 resolve routes. They are **hidden by default**; enable **Settings → Addons → Show Experimental Integrations** to reveal them. Turning that toggle ON auto-enables all built-ins. **Release users add their own HTTPS manifests** — builtins are for developer testing only.

---

## Manifest format (power users)

Host a JSON file over **HTTPS**. Paste the **URL to this JSON file** in Settings → Addons.

User manifests can match or exceed builtin capability:

| Field | Purpose |
|-------|---------|
| `name`, `version`, `tier` | Display + resolve priority (1–4) |
| `defaults.provider` | Default `MediaProvider` for rows without `provider` |
| `defaults.transport` | Default `MediaTransport` (`element-src`, `stream-proxy`, `p2p`, `debrid`) |
| `search.endpoint` | Public HTTPS URL with `{query}` placeholder; also `{api_key}`, `{client_id}`, etc. from addon config |
| `search.method` | `GET` (default) or `POST` |
| `search.bodyTemplate` | POST body JSON with `{query}` and config placeholders |

### Minimal manifest

```json
{
  "name": "My Search Provider",
  "version": "1.0.0",
  "tier": 2,
  "search": {
    "endpoint": "https://example.com/search?q={query}"
  }
}
```

### Full-power manifest (tier34 wrapper example)

Point `search.endpoint` at your tier34 host (or any HTTPS API) and return rows with explicit `provider` / `transport`:

```json
{
  "name": "My Tier34 Audius",
  "version": "1.0.0",
  "tier": 2,
  "defaults": {
    "provider": "stream-proxy",
    "transport": "element-src"
  },
  "search": {
    "endpoint": "https://YOUR_TIER34_HOST/api/addon/audius/resolve",
    "method": "POST",
    "bodyTemplate": "{\"query\":\"{query}\",\"app_name\":\"MyApp\"}"
  }
}
```

### Response shape

Your search endpoint must return JSON with one of:

- `results[]`
- `tracks[]`
- `stations[]` (radio)

Each row:

```json
{
  "id": "unique-id",
  "title": "Track or station name",
  "artist": "Artist or country · tags",
  "url": "https://full-stream-url or /api/proxy/stream?url=...",
  "durationSeconds": 240,
  "artworkUrl": "https://...",
  "provider": "stream-proxy",
  "transport": "element-src",
  "resolveHint": "optional:opaque-hint"
}
```

**Full streams only** — never return 30s `audio-ssl` preview URLs.

### Config placeholders

Builtins store config in `addonStorage` (e.g. Audius `api_key`, SoundCloud `client_id`). User manifests can use the same `{key}` substitution in `search.endpoint` and `search.bodyTemplate` once config UI is added per-addon; for now, embed keys in your hosted manifest endpoint server-side.

---

## Built-in dev-test pack (experimental toggle)

| Addon | Tier34 route | Notes |
|-------|--------------|-------|
| SoundCloud | `POST /api/addon/soundcloud/resolve` | Optional `client_id` |
| WebTorrent | `POST /api/addon/webtorrent/resolve` | RD + Prowlarr when configured |
| IPFS | `POST /api/addon/ipfs/resolve` | Archive mesh |
| Radio Browser | `POST /api/addon/radio-browser/search` | Live radio — play-only, not per-track download |
| Audius | `POST /api/addon/audius/resolve` | Optional `api_key` / `app_name` |
| Soulseek | `POST /api/addon/soulseek/resolve` | Requires [slskd](https://github.com/slskd/slskd) on tier34 host — no external API |

Tier 3 proxy order: **yt-dlp → Invidious → Piped → archive**.

---

## Soulseek (slskd) setup

Soulseek runs **headless on the server** via [slskd](https://github.com/slskd/slskd). The phone never talks to Soulseek directly — only tier34 does.

```
Phone → tier34 :3001 → slskd REST :5030 → Soulseek network
      → download completes → shared volume → locker blobs → phone sync
```

### Docker (optional profile)

```bash
# Create .env next to docker-compose.yml:
# SLSKD_SLSK_USERNAME=your_soulseek_user
# SLSKD_SLSK_PASSWORD=your_soulseek_password

docker compose -f docker-compose.yml -f docker-compose.soulseek.yml --profile soulseek up -d --build
```

### tier34 environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `SOULSEEK_SLKD_URL` | — | slskd base URL, e.g. `http://slskd:5030` or `http://localhost:5030` |
| `SOULSEEK_SLKD_API_KEY` | — | Optional `X-API-KEY` when slskd web auth is enabled |
| `SOULSEEK_DOWNLOADS_PATH` | `/data/slskd-downloads` | Must match slskd downloads dir (shared volume in compose) |

When slskd is not configured or unreachable, Soulseek addon returns **empty results** — yt-dlp and other sources continue normally.

### Test from phone

1. Start slskd + tier34 with Soulseek credentials configured.
2. In the app: **Settings → Addons → Show Experimental Integrations** ON.
3. Connect phone to tier34 (LAN IP).
4. Search **"Lil Wayne No Ceilings"** — Soulseek hits appear alongside other tiers.
5. Tap play (tier34 downloads via slskd, then streams) or **Acquire** to save to locker.

### curl

```bash
curl -s -X POST http://localhost:3001/api/addon/soulseek/resolve \
  -H 'Content-Type: application/json' \
  -d '{"query":"Lil Wayne No Ceilings"}' | jq '.results[0]'
```

---

## Real-Debrid vs Jellyfin/Plex mount

Sandbox does **not** mount Real-Debrid as a FUSE/library folder. Tier34 **unrestricts** a magnet or URL **at play time** and passes a **direct ephemeral stream URL** to the player. Optional **Acquire** downloads the file into your **Locker** — it does not expose RD as a browsable server cache. This differs from Jellyfin/Plex RD plugins that expect a mounted path.

---

## Recommended workflow

### 1. Test now (development)

```bash
npm install
npm run dev:all
```

Open http://localhost:3002 → **Settings → Addons** → paste manifest URL → **Add addon**.

### 2. What to verify

- Manifest URL loads (HTTP 200, valid JSON).
- User manifest hits appear in search and playback **without** experimental toggle.
- Builtins appear only with **Show Experimental Integrations** ON.
- Tier 3/4 / addon routes need tier34 URL in Settings (LAN IP on phones).

### 3. Do not bundle private URLs in public builds

No personal addon URLs in source, F-Droid metadata, or committed config.

---

## curl smoke tests

With tier34 on `http://localhost:3001`:

```bash
# Piped in proxy chain (after yt-dlp + Invidious miss)
curl -s -X POST http://localhost:3001/api/proxy/resolve \
  -H 'Content-Type: application/json' \
  -d '{"query":"bohemian rhapsody official audio"}' | jq '.results[0]'

# Radio Browser search
curl -s -X POST http://localhost:3001/api/addon/radio-browser/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"jazz"}' | jq '.results[0]'

# Radio stream proxy (use url from search result)
curl -sI "http://localhost:3001/api/addon/radio-browser/stream?url=STREAM_URL_ENCODED"

# Audius resolve
curl -s -X POST http://localhost:3001/api/addon/audius/resolve \
  -H 'Content-Type: application/json' \
  -d '{"query":"electronic","app_name":"SandboxMusic"}' | jq '.results[0]'

# SoundCloud (experimental)
curl -s -X POST http://localhost:3001/api/addon/soundcloud/resolve \
  -H 'Content-Type: application/json' \
  -d '{"query":"lofi hip hop"}' | jq '.results[0]'

# Health (features list includes addon-radio-browser, addon-audius, proxy-piped)
curl -s http://localhost:3001/health | jq '.features'
```

---

## Summary

1. **User manifests are live** — always race in search + playback when installed.
2. **Builtins are dev-test only** — experimental toggle + auto-enable.
3. **Manifests can be as powerful as builtins** — POST, provider/transport, tier34 endpoints.
4. **RD is ephemeral stream resolve**, not a library mount.
5. **Full streams only** — no 30s Apple previews.
