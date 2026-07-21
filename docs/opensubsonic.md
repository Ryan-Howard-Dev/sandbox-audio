# OpenSubsonic API (tier34)

Read-only locker browse/stream for Symfonium, Feishin, and other Subsonic clients.

Enable with env on the Sandbox Server:

```bash
SUBSONIC_ENABLED=true
SUBSONIC_USER=sandbox
SUBSONIC_PASSWORD=your-secret
SUBSONIC_BASE_URL=http://192.168.1.10:3001   # optional; LAN IP for clients
```

## Implemented endpoints

| Endpoint | Notes |
| --- | --- |
| `ping` | Health |
| `getLicense` | Always valid (local) |
| `getMusicFolders` | Single "Locker" folder |
| `search2` | Meilisearch + fallback text match |
| `getAlbumList` / `getAlbumList2` | Newest, alphabetical, random |
| `getAlbum` / `getAlbum2` | Album + tracks |
| `getArtist` / `getArtist2` | Artist + albums + tracks |
| `getSong` | Single track metadata |
| `getRandomSongs` / `getRandom` | Random locker tracks |
| `getPlaylists` | From synced locker manifest playlists |
| `getPlaylist` | Manifest playlist entries |
| `stream` | Blob file stream |
| `getCoverArt` | Cover blobs |

Playlists map from locker smart/manual playlists pushed via cross-device sync (`LockerSyncManifest.playlists`).

## curl examples

Replace `USER`, `PASS`, and `BASE`. Use `f=json` or `Accept: application/json`.

```bash
BASE=http://localhost:3001
AUTH="u=sandbox&p=your-secret&v=1.16.1&c=test&f=json"

# Ping
curl -s "$BASE/rest/ping.view?$AUTH"

# Newest albums
curl -s "$BASE/rest/getAlbumList2.view?$AUTH&type=newest&size=10"

# Artist (id from search/album metadata artistId)
curl -s "$BASE/rest/getArtist.view?$AUTH&id=artist-abc123"

# Single song
curl -s "$BASE/rest/getSong.view?$AUTH&id=ENVELOPE_ID"

# Random tracks
curl -s "$BASE/rest/getRandomSongs.view?$AUTH&size=5"

# Playlists
curl -s "$BASE/rest/getPlaylists.view?$AUTH"

# Playlist tracks (id from getPlaylists)
curl -s "$BASE/rest/getPlaylist.view?$AUTH&id=playlist-uuid"

# Stream (binary — pipe to file)
curl -s "$BASE/rest/stream.view?$AUTH&id=ENVELOPE_ID" -o track.flac
```

## Client configuration

- **Server URL:** `http://<tier34-host>:3001`
- **Username / password:** match `SUBSONIC_USER` / `SUBSONIC_PASSWORD`
- **HTTPS:** terminate TLS on reverse proxy; set `SUBSONIC_BASE_URL` to public URL

Implementation: `tier34-server/routes/subsonic.ts`
