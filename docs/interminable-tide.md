# Interminable Tide

Anti-scraper stream trap for the Sandbox Music **tier34** server. It targets unauthorized ripping bots and harvesters — **not** authenticated Subsonic clients or the Sandbox app.

## Ethics

Use this only to protect **your own locker** on infrastructure you control. Do not deploy against third-party services. The goal is to waste attacker disk and CPU while keeping legitimate playback working.

## How it works

When **Defense Protocol** is enabled and a stream request is **flagged**:

| Mode | Behavior |
|------|----------|
| `chaff` | Infinite procedural WAV/FLAC (valid headers, chunked encoding, no `Content-Length`) |
| `jitter` | Valid media preamble, then volatile delays and fluctuating pseudo-bitrate chunks |
| `both` | Alternates chaff/jitter per client IP hit parity |
| `off` | Disabled |

The server does not refuse flagged requests outright — it establishes a connection and simulates valid transmission.

## Detection heuristics

A request is **never flagged** when any bypass applies:

- Valid Subsonic token auth (`u` + `t`/`s`, or `p`)
- `X-Sandbox-Client: sandbox-music/<version>` header
- `sb_client=sandbox-music/<version>` query param (for `<audio>` / ExoPlayer)
- Non-empty `X-Sandbox-Token` or `token=` (OAuth session)
- `Origin` or `Referer` matching `TIER34_CORS_ORIGIN` (web app)

Otherwise, flag when **any** of:

- **Subsonic stream** (`/rest/stream.view`) without valid auth
- **Bad User-Agent**: `ffmpeg`, `wget`, `curl`, `yt-dlp`, `youtube-dl`, `streamrip`, `aria2`, `httpie`
- **Rate threshold**: >40 stream hits per IP per minute (configurable via `TIER34_TIDE_RATE_THRESHOLD`)
- **Strict mode** (`TIER34_DEFENSE_STRICT=true`): missing `X-Sandbox-Client` / `sb_client`

## Protected endpoints

- `/rest/stream.view` (OpenSubsonic)
- `/api/stream/*`
- `/api/proxy/stream`
- `/api/locker/blob/:hash`

Cast/DLNA speaker pulls are not flagged unless they exhibit scraper signals (bad UA, rate spike).

## Configuration

```env
TIER34_DEFENSE_PROTOCOL=true
TIER34_INTERMINABLE_TIDE=chaff   # chaff | jitter | both | off
# TIER34_DEFENSE_STRICT=false
# TIER34_TIDE_RATE_THRESHOLD=40
```

Runtime overrides via `PATCH /api/security/defense-protocol`:

```json
{
  "enabled": true,
  "interminableTide": "both",
  "defenseStrict": false
}
```

## Client identification

The Sandbox app sends:

- Header: `X-Sandbox-Client: sandbox-music/1.0.0` on fetch-based stream downloads
- Query: `sb_client=sandbox-music/1.0.0` on URLs used by `<audio>`, ExoPlayer, and cast resolvers

## Safe local testing

**WARNING:** Production tide streams are infinite. Always cap duration with `--max-time`.

### Admin test route (localhost only, defense ON)

```bash
curl -v --max-time 5 "http://localhost:3001/api/security/interminable-tide/test?maxSec=5"
```

### Simulate a flagged scraper (Subsonic stream, no auth)

```bash
curl -v --max-time 5 -A "yt-dlp/2024.1.1" \
  "http://localhost:3001/rest/stream.view?id=some-track-id"
```

### Simulate legitimate app client

```bash
curl -v --max-time 5 \
  -H "X-Sandbox-Client: sandbox-music/1.0.0" \
  "http://localhost:3001/api/stream/some-id/full"
```

### Debug query on any stream path (localhost only)

```bash
curl -v --max-time 5 \
  "http://localhost:3001/api/stream/test-id/full?tide=test&maxSec=3"
```

### Verify bypass — authenticated Subsonic

```bash
# Replace u, t, s with valid md5(password+salt) token pair
curl -v --max-time 5 \
  "http://localhost:3001/rest/stream.view?id=TRACK_ID&u=sandbox&t=TOKEN&s=SALT"
```

## Settings UI

**Settings → Defense → Defense Protocol** hint text documents Interminable Tide and links here.
