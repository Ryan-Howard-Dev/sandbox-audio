# Sandbox Cast (Android)

Sovereign Music Console casts to TVs and receivers (including NVIDIA Shield) from the **Capacitor Android APK** using the official **Google Cast SDK for Android** (`NativeCast` plugin). The Web Sender SDK inside the WebView is not used on Android.

## Requirements

| Requirement | Notes |
| --- | --- |
| Google Play services | Cast framework depends on Play services (preinstalled on most devices; Shield TV includes Cast receiver) |
| Same Wi‑Fi subnet | Phone/tablet and Cast receiver must share LAN |
| tier34 LAN base URL | Locker / blob tracks need HTTP stream URLs (`/api/cast/stream/…`) — set tier34 to your machine IP in app settings |
| Gradle deps | `play-services-cast-framework:21.5.0`, `androidx.mediarouter:mediarouter:1.7.0` |

## Architecture

```
sandboxLayer3 (host player, playQueue)
  → castState.syncCastEnvelope()
  → castSender (native path on Android)
  → nativeCast.ts (Capacitor bridge)
  → NativeCastPlugin.java (CastContext, SessionManager, RemoteMediaClient)
  → TV / receiver
```

There is **no second player** in the app for Sandbox Cast. The host WebView audio engine stays authoritative; Cast receives load/play/pause/seek commands and optional queue metadata mirrored from `playQueue`.

## Build

```bash
npm run build:android
cd android && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

1. Open **Android Studio → File → Sync Project with Gradle Files** after pulling Cast changes.
2. Ensure SDK 36 and a recent JDK (21) match `android/variables.gradle`.

### Typecheck

```bash
npm run lint
```

## Test on NVIDIA Shield

1. Install the debug APK on your phone (controller) — not on the Shield; the Shield is the **receiver**.
2. Start **tier34** on your PC with LAN IP configured in Sovereign settings.
3. Load a track (prefer locker/proxy with resolvable cast stream URL).
4. Open **Sandbox Cast → Connect Sandbox Cast (Native)**.
5. Pick your Shield in the system Cast picker.
6. Verify: playback on TV, metadata (title/artist/art), play/pause from Player Bar, skip next/prev updates TV track when queue has resolvable URLs.

## Plugin API (JS)

See `src/nativeCast.ts`:

- `initNativeCast({ receiverApplicationId? })`
- `requestNativeCastSession()` — opens system Cast device picker
- `endNativeCastSession()`
- `syncNativeCastPlayback(payload)` — stream URL, transport, metadata, optional queue
- `sessionStateChanged` listener — connected, device name

`castSender.ts` and `castState.ts` route Android through this bridge automatically.

## Permissions (`AndroidManifest.xml`)

- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `ACCESS_WIFI_STATE` (Cast device discovery)

## Limitations

- **Custom Cast receiver** (`VITE_CAST_RECEIVER_APP_ID`) is saved for the next cold start; default receiver is `CC1AD845` (default media receiver).
- **Sandbox Cast controls** (play/pause on TV remote) adjust receiver playback only; host `playQueue` index does not automatically follow TV remote skip unless you skip from the Sovereign Player Bar.
- **Visualizer / cinema custom namespace** is Web Sender + custom receiver only; native path loads standard media metadata.
- **Devices without Play services** cannot use native Sandbox Cast; the UI falls back to “Open in Chrome” only when native Cast is unavailable.
- **Queue sync** requires each queued track to resolve to an HTTP LAN URL via tier34; blob-only tracks are skipped in the Cast queue.

## Related docs

- `docs/android-playback.md` — background MediaSession (separate from Sandbox Cast)
- `src/castStreamResolver.ts` — tier34 cast stream URL resolution
