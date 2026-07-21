# Scrobbling

Sandbox Music scrobbles from the client when **Settings → Playback → Scrobbling** is enabled.

## Last.fm setup (Settings UI)

1. Create an API account: https://www.last.fm/api/account/create
2. Settings → Playback → Scrobbling → enable **Last.fm**
3. Paste **API key** and **username**
4. Use **Open Last.fm auth** (or visit https://www.last.fm/api/auth?api_key=YOUR_KEY)
5. Approve access; obtain **session key (sk)** from the redirect URL token or `auth.getSession`
6. Paste session key in Settings

Ephemeral Chamber (Settings → Privacy & security) stores keys in sessionStorage when enabled.

## ListenBrainz

1. Generate a user token at https://listenbrainz.org/profile/
2. Settings → Playback → enable **ListenBrainz** and paste token

## Air-Gap Mode

When **Settings → Privacy & security → Air-Gap Mode** is ON:

- Direct client requests to Last.fm and ListenBrainz are **blocked**
- Settings shows a hint under Scrobbling
- **LAN relay (MVP):** if a Sandbox Server URL is configured and the server has WAN, Last.fm calls can forward via `POST /api/scrobble/relay` on tier34. ListenBrainz relay is not implemented yet.

LAN Party preset enables Air-Gap automatically.

## Rules

- Now-playing fires on track start
- Scrobble when listened ≥ 30s and ≥ min(50% duration, 4 minutes)
- Implementation: `src/scrobble.ts`

## Tier34 relay (maintainers)

```bash
curl -s -X POST http://localhost:3001/api/scrobble/relay \
  -H 'Content-Type: application/json' \
  -d '{
    "method": "track.updateNowPlaying",
    "apiKey": "YOUR_KEY",
    "sessionKey": "YOUR_SK",
    "params": { "artist": "Artist", "track": "Title" }
  }'
```

Server must reach `ws.audioscrobbler.com`. Client air-gap + LAN server is the intended car-Pi / hotspot pattern.
