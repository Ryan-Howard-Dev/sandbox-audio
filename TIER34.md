# Tier 3 & 4 Backend

The **Sovereign extraction node** runs separately from the Vite UI server (port **3002**).

## Quick start

```bash
npm install
npm run dev:all
```

- UI: http://localhost:3002  
- Tier 3/4 API: http://localhost:3001  
- Health: http://localhost:3001/health  

In **Settings → Playback Engine** → **Sovereign System Status**, set **YT-DLP BACKEND URL** to your tier34 host (default `http://localhost:3001` on desktop). On phones, use the LAN IP (e.g. `http://192.168.1.10:3001`), not `localhost`.

## What runs on 3001

| Feature | Endpoint |
|--------|----------|
| Proxy search (Tier 3) | `GET /api/search/proxy?q=` |
| Proxy resolve (yt-dlp → Invidious → Piped) | `POST /api/proxy/resolve` |
| Proxy stream | `GET /api/proxy/stream?url=` |
| Debrid / lossless (Tier 4) | `GET /api/search/debrid?q=` |
| Addon: SoundCloud | `POST /api/addon/soundcloud/resolve` |
| Addon: WebTorrent | `POST /api/addon/webtorrent/resolve` |
| Addon: IPFS | `POST /api/addon/ipfs/resolve` |
| Addon: Radio Browser | `POST /api/addon/radio-browser/search`, `GET /api/addon/radio-browser/stream?url=` |
| Addon: Audius | `POST /api/addon/audius/resolve` |
| Addon: Soulseek | `POST /api/addon/soulseek/resolve` |
| Spectral entropy analyzer | `POST /api/analyze/spectral` |
| Acoustic fingerprint | `POST /api/fingerprint/match` |
| AcoustID on acquire | tier34 acquire worker (`enriching` step) |
| Stem-aware failover | `POST /api/stem/failover` |
| Sonic DNA profiling | `POST /api/sonic-dna/profile` |
| DHT resolve + playback | `POST /api/dht/resolve` |
| Dead-source auto-heal | `POST /api/heal/dead-source` |
| OAuth playlist bridges | `GET /api/oauth/:provider/authorize` |
| Feed pipeline | `GET /api/feed` |
| Mixes pipeline | `POST /api/mixes` |
| Videos pipeline | `GET /api/videos?q=` |
| Peer playback sync | `WS /peer-sync?room=` |
| Locker sync (optional) | `POST/GET /api/locker/manifest`, `GET/PUT /api/locker/blob/:hash` |

Search uses **Archive.org** audio files and **iTunes preview** URLs as real stream sources (no mock empty arrays). Locker blob replication is documented in [LOCKER_SYNC.md](./LOCKER_SYNC.md).

## OAuth

1. **Collection → Playlists → External Transfer → Connect Spotify (OAuth)**  
2. Complete the browser flow (demo token works without `SPOTIFY_CLIENT_ID`).  
3. **Sync External Playlist** imports via `GET /api/oauth/playlists`.

For live Spotify, set in `.env`:

```
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=http://localhost:3001/api/oauth/spotify/callback
```

## AcoustID (acquire fingerprinting)

During **acquire** jobs, each downloaded track enters an `enriching` step: Chromaprint (`fpcalc`) + AcoustID lookup, then MusicBrainz recording/release ids on the locker manifest. Duplicates are skipped when the same SHA-256 or MusicBrainz recording is already in the locker.

1. Install **Chromaprint** on the tier34 host (`fpcalc` on `PATH`):
   - Windows: [chromaprint releases](https://github.com/acoustid/chromaprint/releases) or `choco install chromaprint`
   - macOS: `brew install chromaprint`
   - Linux: `apt install libchromaprint-tools` (package name may vary)
2. Register a free API key at [acoustid.org/new-application](https://acoustid.org/new-application)
3. Set in `.env` (same file as tier34):

```
ACOUSTID_API_KEY=...
```

Without `fpcalc` or `ACOUSTID_API_KEY`, acquire still completes using embedded tags and catalog metadata; fingerprint dedup is degraded.

`POST /api/fingerprint/match` accepts `{ fingerprint, durationSeconds }` or `{ contentHash }` (locker blob) for real AcoustID lookup, with text-hash fallback when Chromaprint is unavailable.

## Server Library (Jellyfin / Navidrome)

Browse and stream home-network libraries from the **Server Library** station (Settings → Addons → enable **SERVER LIBRARY**).

| Route | Purpose |
|--------|---------|
| `POST /api/library/ping` | Test credentials |
| `POST /api/library/subsonic` | Navidrome / Subsonic API proxy |
| `POST /api/library/jellyfin` | Jellyfin REST proxy |
| `POST /api/library/jellyfin/auth` | Jellyfin token exchange |
| `POST /api/library/stream-url` | Mint short-lived stream token |
| `GET /api/library/stream?t=` | Proxied audio stream |

Credentials stay in the client; tier34 forwards requests to LAN hosts (private IPs allowed). Stream URLs use HMAC tokens — set `LIBRARY_STREAM_SECRET` in production.

**Navidrome:** `http://host:4533` + username/password (Subsonic API).

**Jellyfin:** `http://host:8096` + username/password.

## Feed station

The **Feed** nav item (`src/sandboxLayer3.tsx` → `FeedView`) lists releases from the Tier 3/4 mesh.

- Client: `tier34FetchFeed()` in `src/tier34/client.ts`
- Backend: `GET /api/feed` on port **3001**
- Requires `npm run dev:tier34` or `npm run dev:all`; empty state prompts when the pipeline is offline

Items group into **New updates**, **Last week**, and **Last month** (Archive + preview index). Tap a row to queue playback.

## Sandbox Connect

Multi-device **playback sync** (not locker file replication — see [LOCKER_SYNC.md](./LOCKER_SYNC.md)).

1. **Settings → Playback Engine** → enable **Sandbox Connect**.
2. First enable opens **ConnectSetupWizard** (`src/components/ConnectSetupWizard.tsx`):
   - **Host URL** — tier34 base URL on your LAN (phones must not use `localhost`)
   - **Role** — auto (desktop/Tauri = host, phone = remote), host, or remote
   - **Device name** — shown to other peers; optional test connection on the last step
3. Re-open the wizard anytime via **Set up Connect** while Connect is enabled.
4. Host device plays audio and publishes queue state; remotes send transport commands only.
5. Relay: WebSocket `ws://<tier34>/peer-sync?room=sandbox-room` on the Tier 3/4 server.

**Sovereign System Status** (same Settings tab) polls tier34, Meilisearch, yt-dlp, DLNA, Connect, and locker-sync health every 20s. **Settings → Diagnostics** runs the full Tier34 validation suite (locker sync, acquire worker, Connect, cast).

## Artist images

Catalog and artist detail views resolve photos via `src/artistImage.ts` (TheAudioDB lookup, client cache). The main UI server proxies lookups at `GET /api/artist-image?name=` (`server.ts`, port **3002**) so the browser never calls TheAudioDB directly. Works for any artist name, not a single hard-coded profile.

## Desktop build (Tauri)

```bash
npm run build
npm run build:desktop
```

Requires [Rust](https://rustup.rs/) and Windows build tools for `.exe` output under `src-tauri/target/release/`.

`tauri.conf.json` already points `devPath` at `http://localhost:3002`.

## Real-Debrid (not a library mount)

Sandbox **does not** mount Real-Debrid as a FUSE folder like some Jellyfin/Plex RD plugins. Flow:

1. **Play** — Prowlarr finds a torrent/link → Tier34 asks RD to **unrestrict** → player receives a **direct ephemeral HTTPS stream URL** (expires; not a mounted path).
2. **Acquire** (optional) — Tier34 downloads the unrestricted file into your **Locker** blob store for offline replay.

RD is resolve-at-play-time, not a browsable server cache. If RD mount worked poorly in Jellyfin/Plex, Sandbox avoids that model entirely.

## Limitations (honest)

- **Prowlarr / Real-Debrid** — wired when keys are set in tier34 `.env` or Settings → Playback Engine; without keys, Tier 4 falls back to Archive FLAC bias + proxy tier.  
- **Stem separation** — `POST /api/stems/analyze` runs Demucs on the server (background job); stems are stored as locker blobs. The player **Stem mix** panel streams those cached stems (not live Demucs). `POST /api/stem/failover` is source failover, not demixing.  
- **DHT** resolves via indexed search + content hashes, not a live IPFS daemon.  
- **Videos** open in browser (Invidious metadata); inline player is future work.

These are functional pipelines you can extend with your own API keys and binaries.
