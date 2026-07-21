# Multi-platform testing checklist

Actionable verification steps referencing real Settings paths. Test in order: **Windows (Tauri) → Android OnePlus 12 → NVIDIA Shield Android TV → Linux Tauri (Pop!_OS / Shield later)**.

## Windows — Tauri desktop

**Packaged `.exe` (no dev server on :3002)**

The installer ships the UI only — not `server.ts` (port **3002**) or `tier34-server` (port **3001**). Catalog **images** and **30s preview playback** use direct HTTPS to Apple iTunes / TheAudioDB from the app. Full-stream resolve, acquire, and locker search need a running Sandbox Server.

| Goal | What to do |
| --- | --- | --- |
| Catalog previews + artwork | Works out of the box with internet — no server required |
| Full streams / acquire / Meilisearch | Run tier34 separately **or** Settings → Device storage → **Sandbox Server** → **Server on this PC** (dev tree + Node) **or** set **Server URL** to a LAN tier34 (`http://192.168.x.x:3001`) |
| Dev with auto-start | From source: `npm run dev:tier34` then `npm run tauri dev` |

**Build / run**

```powershell
npm run dev:tier34
npm run tauri dev
```

`dev:tier34` kills any stale process on port **3001** before starting (via `kill-port`), so rebuilt server code is always loaded. Use `npm run dev:tier34:restart` for the same behavior if tier34 is already running.

| Step | Settings path | Expected |
| --- | --- | --- |
| Audiophile WASAPI | Settings → Playback → **Audiophile playback (desktop)** → Enable | Status shows native engine; FLAC/WAV plays without WebView resample |
| Anchor server | Settings → Device storage → **Sandbox Server** → **Server on this PC** | Tier34 on `http://127.0.0.1:3001`; health OK in Settings → Diagnostics |
| Watch folder | Settings → Device storage → **Watch folder** (or tier34 `TIER34_WATCH_PATH`) | New audio in watched folder appears in locker after ingest |
| Defense protocol | Settings → Privacy & security → **Defense protocol (server)** | Toggle PATCHes tier34; proxy streams respect allowlist when ON |
| OpenSubsonic | Configure Symfonium/Feishin → tier34 `/rest/*` | Browse albums, playlists, stream (see [opensubsonic.md](./opensubsonic.md)) |
| Scrobbling | Settings → Playback → **Scrobbling** | Last.fm auth link + session key; scrobbles on eligible plays |
| Typecheck | `npx tsc --noEmit` && `cargo check` | Clean |
| Unit tests | `npm run test` | Vitest suite passes |

## Android — OnePlus 12 (phone)

**Build / install**

```bash
npm run build:android:apk
adb uninstall rd.sheepskin.sandboxmusic
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

| Step | Settings path | Expected |
| --- | --- | --- |
| No server onboarding | Onboarding → **No server** | Search works; **30s catalog previews** play without tier34 |
| Catalog preview | Search → play any **STREAMABLE** hit (no server URL) | 30s Apple preview audio; toast if network blocks iTunes CDN |
| Full streams | Settings → Addons → **Server URL** → `http://<PC-LAN-IP>:3001` (phone + PC on same Wi‑Fi) | YouTube/resolve full streams via `/api/resolve`; cleartext HTTP allowed in APK |
| Remote tier34 | Settings → Addons → **Server URL** → `http://<PC-LAN-IP>:3001` | Diagnostics shows server online |
| ExoPlayer | Settings → Playback → **Experimental native playback (ExoPlayer)** | Locker tracks play via HTTP blob URL; status mentions tier34 HTTP |
| Gapless handoff | Settings → Playback → **Gapless playback** ON + ExoPlayer ON | Next track preloads in Exo queue (no crossfade) |
| Acquire | Search → Acquire on a track | Progress toast; file in locker when tier34 acquire enabled |
| Android Auto | Connect USB / AA wireless | Browse locker roots (see [android-auto.md](./android-auto.md)) |
| Scrobbling | Settings → Playback → Last.fm | Now-playing + scrobble after 50% / track end |
| Background | Home while playing | Notification + lock screen controls |

## Android — new install + offline ExoPlayer

Verify default native decode and locker `content://` playback after a clean install (see [android-playback.md](./android-playback.md)).

```bash
npm run build:android:apk
adb uninstall rd.sheepskin.sandboxmusic
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

| Step | Settings path | Expected |
| --- | --- | --- |
| Default prefs | Settings → Playback (first launch) | **Native playback (ExoPlayer)** ON; **Gapless playback** ON |
| Offline locker | Airplane mode ON; no Settings → Addons → **Server URL** | Pre-acquired locker album plays without tier34 |
| content:// URIs | During offline play: `adb logcat -s NativeExoPlayback` | `playUrl` / status lines show `content://…locker/` (not `blob:`) |
| Gapless handoff | Same session — 3+ consecutive offline tracks | Continuous boundaries; log shows `queueLength` rising before each transition |
| WebView crossfade | Settings → Playback → **WebView playback (crossfade)** ON | Exo disables; manual skip mid-track → ~2.5s fade; turn OFF to restore native |

**Device notes**

- **OnePlus 12**: Notification shade / Fluid Cloud chip should update per track at gapless boundaries.
- **Shield TV**: Repeat offline locker + logcat via `adb connect <shield-ip>`; D-pad Locker → play album on leanback UI.

## NVIDIA Shield — Android TV

| Step | Settings path | Expected |
| --- | --- | --- |
| TV navigation | D-pad / remote | All stations reachable; focus rings visible |
| Partial coverage | First launch / unsupported feature | Banner explains TV limitations (see [android-tv-readiness.md](./android-tv-readiness.md)) |
| Remote tier34 | Settings → Addons → Server URL | Same LAN server as phone/PC |
| API key sync | Settings → Addons → Server URL (same as PC) + Security → **Sync keys via Sandbox Server** ON | Enter Real-Debrid / Prowlarr on Windows once; Shield pulls keys without re-entry after Remote URL set |
| Playback | Locker → play album | Audio continues; no touch-only dead ends |
| Cast / DLNA | Optional LAN speakers | Settings → Device storage → network speakers |

## Linux — Tauri (Pop!_OS / Shield desktop later)

| Step | Settings path | Expected |
| --- | --- | --- |
| PipeWire audiophile | Settings → Playback → Audiophile → device picker | PipeWire or ALSA device listed; bit-perfect path when supported |
| Anchor server | Settings → Device storage → Sandbox Server → **Server on this PC** | Tier34 listens; CORS matches dev origin |
| Defense + OpenSubsonic | Same as Windows | PATCH defense; `/rest/ping` OK |

## Cross-cutting

- **Air-Gap / LAN Party**: Settings → Privacy & security → Air-Gap or LAN Party — WAN blocked; scrobbling blocked unless tier34 LAN relay configured ([scrobbling.md](./scrobbling.md))
- **Advanced settings**: Settings sidebar **Advanced** → Diagnostics / Signal Bench
- **Acquisition keys**: Settings → Addons → **Show acquisition keys** reveals Prowlarr / Real-Debrid fields
