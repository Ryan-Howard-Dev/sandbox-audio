# Android Auto — browse/play (Phase 2)

Sandbox Music exposes an Android Auto / Automotive **media browse** path with locker albums, playlists, play queue, and basic voice search.

Full Google Play certification and custom voice utterances remain optional future work. Native ExoPlayer decode is available via Settings → Playback (see [android-playback.md](./android-playback.md)).

## What is wired

| Layer | File | Role |
| --- | --- | --- |
| Native browse service | `android/.../SandboxMediaBrowserService.java` | `MediaBrowserServiceCompat`; search supported |
| Browse tree bridge | `android/.../AndroidAutoBridge.java` | Queue, albums, playlists, search results |
| Capacitor plugin | `android/.../AndroidAutoPlugin.java` | `setBrowseQueue`, `setBrowseLibrary`, `setBrowseSearchResults`, events |
| JS sync | `src/androidAuto.ts` | Pushes browse nodes; handles play + search |
| Playback session | `MediaPlaybackForegroundService.java` | `onPlayFromMediaId`, `onPlayFromSearch` → JS |
| Shell wiring | `src/sandboxLayer3.tsx` | Sync on locker/playlist/queue changes |

### Browse tree shape

```
sandbox_root
├── Play Queue (sandbox_queue)
│   └── tracks…
├── Locker Albums (sandbox_albums)
│   └── sandbox_album:{collectionKey}
│       └── tracks…
├── Playlists (sandbox_playlists)
│   └── sandbox_playlist:{playlistId}
│       └── tracks…
└── Search Results (sandbox_search)   ← after voice search
    └── tracks…
```

Selecting a track emits `playFromMediaId` with the envelope id (`local-{lockerId}` for vault tracks).

### Voice search

1. Car UI sends a search query via `MediaSession.onPlayFromSearch` or `MediaBrowserService.onSearch`.
2. Native forwards `searchQuery` to the WebView.
3. JS runs `runUnifiedSearch` (locker-local → Meilisearch → catalog).
4. First locker/catalog track **auto-plays**; up to 20 hits sync to **Search Results** for browse.

Requires network for catalog leg; locker-local matches work offline.

## Build & manual test

```bash
npm run build:android:apk
```

Install on a device with Android Auto (phone + head unit, or Desktop Head Unit).

1. Open Sandbox Music — ensure locker has albums and at least one playlist.
2. Connect Android Auto.
3. Open **Sandbox Music** in the car media app list.
4. Browse **Locker Albums** → pick an album → play a track.
5. Browse **Playlists** → play a track.
6. Browse **Play Queue** while playback is active.
7. Voice: “Play {artist or track}” — should search and start first match; check **Search Results** if browse refresh is delayed.

### Desktop Head Unit (developer)

```bash
adb forward tcp:5277 tcp:5277
desktop-head-unit
```

Package id: `rd.sheepskin.sandboxmusic`.

## Plugin API (JS)

```ts
import {
  initAndroidAutoBridge,
  syncAndroidAutoBrowseQueue,
  syncAndroidAutoBrowseLibrary,
  syncAndroidAutoSearchResults,
  teardownAndroidAutoBridge,
} from './androidAuto';

await initAndroidAutoBridge({
  onPlayFromMediaId: (mediaId) => { /* play envelope */ },
  onSearchQuery: (query) => { /* unified search + play */ },
});

await syncAndroidAutoBrowseLibrary({
  albums: [{ id: 'rg:…', title: 'Album', artist: 'Artist', tracks: [...] }],
  playlists: [{ id: 'pl-1', title: 'Road Mix', tracks: [...] }],
});
```

Library nodes sync automatically from `sandboxLayer3.tsx` when the locker or playlists change.

## Permissions & manifest

- `SandboxMediaBrowserService` is **exported** (`android.media.browse.MediaBrowserService` intent filter).
- `com.google.android.gms.car.application` meta-data → `res/xml/automotive_app_desc.xml`.
- Playback permissions: [android-playback.md](./android-playback.md).

## Not implemented

- Google Android Auto app certification / DHU sign-off checklist
- `registerCarVoiceAction` → native voice intent receiver
- Offline artwork for browse rows

## Next steps

1. Start foreground service when AA connects (shared session at cold start).
2. Expand roots: liked tracks, followed artists, smart playlists.
3. Async search: detach `onSearch` until JS returns fresh results.
