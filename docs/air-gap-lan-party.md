# Air-Gap LAN Party Mode

Sandbox-native **zero-WAN** listening: Connect peers, DLNA renderers, and your offline locker — no catalog or acquire traffic to the public internet.

## Quick enable

1. Open **Settings → Security**.
2. Turn on **LAN PARTY MODE** (also enables Air-Gap Mode).
3. Ensure your **Sandbox Server** (Tier34) URL points at a **LAN host** (e.g. `http://192.168.4.1:8787`), not a cloud VPS.
4. Use **Connect** (Settings → Network) and **DLNA** (see [dlna-mediaserver.md](./dlna-mediaserver.md)) on the same Wi‑Fi or hotspot.

While active:

- Outbound WAN fetches are blocked (catalog proxies, acquire, podcast RSS proxies, etc.).
- Same-origin app UI, locker blobs, playlists, and **private/LAN Tier34** routes still work.
- **LAN feed mirror** — if Tier34 has pre-pulled your subscribed podcasts to NAS, playback uses `/api/podcast/mirror/*` and locker blobs with **no WAN**.

## Car Pi + phone hotspot (Sandbox-native)

Typical road-trip / tailgate layout:

```
┌─────────────┐     Wi‑Fi hotspot      ┌──────────────────┐
│  Your phone │ ◄──────────────────► │  Raspberry Pi    │
│  (Android)  │   192.168.43.0/24    │  Sandbox Server  │
└─────────────┘                      │  + DLNA + locker │
       │                             └──────────────────┘
       │  Sandbox app (Connect remote or direct LAN URL)
       └──────────────────────────────────────────────►
```

### Pi (server + library)

1. Install Sandbox Tier34 server on the Pi (`npm run start:tier34` or production unit).
2. Copy or sync locker manifest + blobs to the Pi (Settings → Vault → sync, or rsync tier34 data dir).
3. Enable DLNA media server on the Pi if you want TV/speaker rendering ([dlna-mediaserver.md](./dlna-mediaserver.md)).
4. Note the Pi’s hotspot IP (often `192.168.4.1` on Pi-as-AP, or DHCP from phone hotspot).

### Phone (client)

1. Join the Pi hotspot **or** share phone hotspot and join the Pi to it.
2. In Sandbox **Settings → Addons**, set Server URL to `http://<pi-lan-ip>:8787`.
3. Enable **LAN PARTY MODE**.
4. Play from locker; use Connect to control the Pi, or DLNA to cast to a TV on the LAN.

### Pop!_OS / desktop (same LAN)

1. Point Server URL at the Pi or another LAN Tier34 host.
2. Enable LAN Party Mode.
3. Search is locker-only; use Sonic Locker or Locker for playback.

## Podcast LAN mirror (air-gap)

Tier34 **cron-pulls** subscribed RSS feeds to NAS (`podcast-mirror/` under storage). LAN clients play from locker blobs — no WAN after the initial pull.

1. While online, subscribe in **Podcasts → My shows** (subscriptions sync to Tier34).
2. Tier34 pulls on a schedule (default every 6h) or use **Pull now** in My shows.
3. Enable **LAN PARTY MODE** — feeds load from `/api/podcast/mirror/feeds/:id/rss`.

| Env | Default | Purpose |
|-----|---------|---------|
| `PODCAST_MIRROR_ENABLED` | on | `0` disables scheduler |
| `PODCAST_MIRROR_INTERVAL_MS` | `21600000` | Pull interval |
| `PODCAST_MIRROR_MAX_EPISODES` | `20` | Episodes per show |
| `PODCAST_MIRROR_MAX_BYTES` | `524288000` | Max episode size |

YouTube podcast lists are not mirrored.

### Local transcripts (Whisper on NAS)

After mirror pull, Tier34 can run **local Whisper** on downloaded episodes — searchable in podcast search with **no third-party APIs**.

1. Install [openai-whisper](https://github.com/openai/openai-whisper) on the Tier34 host (`pip install openai-whisper`) or set `WHISPER_BIN`.
2. Mirrored episodes queue transcription automatically; search matches title + full transcript text.
3. Works on **LAN / air-gap** via `GET /api/podcast/transcripts/search`.

| Env | Default | Purpose |
|-----|---------|---------|
| `PODCAST_WHISPER_ENABLED` | on | `0` disables scheduler |
| `PODCAST_WHISPER_MODEL` | `base` | `tiny` for speed, `small` for quality |
| `PODCAST_WHISPER_INTERVAL_MS` | `1800000` | Batch interval |
| `PODCAST_WHISPER_MAX_JOBS` | `2` | Episodes per batch |
| `PODCAST_WHISPER_MAX_SECONDS` | `10800` | Skip longer episodes |

## What still works vs blocked

| Feature | LAN party |
|--------|-----------|
| Locker playback | Yes |
| Sonic Locker / smart playlists | Yes |
| Connect sync | Yes (LAN) |
| DLNA cast | Yes (LAN) |
| Catalog search / acquire | No (WAN blocked) |
| Podcast RSS / YouTube (live WAN) | No |
| Podcast LAN mirror (NAS cache) | Yes — after Tier34 cron pull |
| Podcast transcript search (local Whisper) | Yes — on LAN Tier34 |
| Lyrics / metadata proxies | No (unless cached) |

## Disable

Turn off **LAN PARTY MODE** in Settings. Air-Gap may stay on until you disable it separately.

## Related

- [offline-capability.md](./offline-capability.md)
- [dlna-mediaserver.md](./dlna-mediaserver.md)
- [android-remote-cast.md](./android-remote-cast.md)
