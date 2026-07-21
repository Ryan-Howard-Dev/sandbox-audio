# DLNA / UPnP MediaServer (Tier34)

Tier34 can advertise your Sandbox Locker as a **DLNA MediaServer** so TVs, receivers, and speakers browse and play tracks **without the Sovereign app running**.

## Enable

Set in `.env` on the tier34 host (or environment):

```bash
DLNA_MEDIASERVER=1
```

Optional:

| Variable | Purpose |
|----------|---------|
| `DLNA_BASE_URL` | LAN-reachable base URL TVs use (recommended). Example: `http://192.168.1.42:3001` |
| `DLNA_HOST` | Host/IP only when `DLNA_BASE_URL` is unset (auto-detects first non-loopback IPv4) |
| `DLNA_FRIENDLY_NAME` | Name shown on TVs (default: `Sovereign Music Locker`) |
| `DLNA_UDN` | Stable device UUID (default: derived from manifest `deviceId`) |

Restart tier34:

```bash
npm run dev:tier34
```

Verify:

```bash
curl http://localhost:3001/dlna/status
curl http://localhost:3001/dlna/device.xml
```

Health endpoint lists `dlna-mediaserver` in `features` when the routes are registered (SSDP starts only when `DLNA_MEDIASERVER=1`).

## Library layout

DLNA clients browse:

```
Root
├── Artists → Albums → Tracks
├── Albums → Tracks
├── All Tracks
└── Playlists → Tracks (from locker sync manifest `playlists[]` when synced)
```

Streams use `http://<host>:<port>/api/cast/stream/<trackId>` (HTTP range requests). Artwork uses `/api/locker/blob/<coverHash>`.

Only tracks with blobs present on the tier34 host are listed.

## Test on NVIDIA Shield

1. Set `DLNA_BASE_URL` to your PC's LAN IP (not `localhost`).
2. Allow **Node.js** / tier34 through Windows Firewall (private network).
3. On Shield: **Settings → Device Preferences → Display & Sound → Cast** or open a DLNA app (e.g. VLC, Plex local, or built-in media apps).
4. Look for **Sovereign Music Locker** (or your `DLNA_FRIENDLY_NAME`).
5. Browse **Artists** or **Albums**, play a track.

If the server does not appear, install a UPnP scanner on another device (e.g. `BubbleUPnP` on Android) to confirm SSDP advertisements.

## Test on LG TV

1. Open the **Music** or **Photo & Video** app (model-dependent) or **LG Media Player**.
2. Choose **DLNA** / **Media Server** / **Home Network**.
3. Select **Sovereign Music Locker**.
4. Navigate Artists → Album → track.

LG TVs require the stream URL to be reachable on the LAN. Use `DLNA_BASE_URL=http://<your-pc-ip>:3001`.

## Windows notes

- **Firewall**: Allow inbound TCP on `TIER34_PORT` (default 3001) and UDP **1900** (SSDP multicast) for private networks.
- **Multicast**: SSDP uses `239.255.255.250:1900`. Some VPNs or hypervisors block multicast; disable VPN or bridge the VM NIC to the LAN.
- **Wi‑Fi isolation**: Guest Wi‑Fi often blocks device-to-device traffic; use the main LAN.
- Tier34 sets `explicitSocketBind` on Windows so node-ssdp binds per interface.

## Limitations (MVP)

- **Audio only** — no video or photos.
- **No server-side DLNA controller** — tier34 does not push playback to renderers; clients pull streams.
- **Playlists** appear only after locker sync pushes `playlists[]` in the manifest (not from browser `localStorage` alone).
- **No search** action — browse hierarchy only.
- **No transcoding** — clients must support MP3/FLAC/OGG as stored in the locker.
- **Single library** — one manifest on the tier34 host.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Server not listed | `DLNA_MEDIASERVER=1`, firewall, `DLNA_BASE_URL` uses LAN IP |
| Empty library | Blobs on tier34 disk; `GET /api/locker/manifest` has entries |
| Play fails | TV can reach `http://<ip>:3001/api/cast/stream/<id>` in a browser on another LAN device |
| Wrong name | `DLNA_FRIENDLY_NAME` |

See also: [SELF_HOST.md](../SELF_HOST.md), [TIER34.md](../TIER34.md).
