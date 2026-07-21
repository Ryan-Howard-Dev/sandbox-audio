# Building Sandbox Music

## Desktop (Windows / Linux)

Sandbox Music and **Sandbox Server** install together via the Tauri desktop app.

1. Install from release bundle or `npm run tauri:dev` for development.
2. On first launch, complete onboarding — anchor mode starts Sandbox Server automatically.
3. **Share with phones:** Settings → Vault → Sandbox Server → copy the **LAN URL** (e.g. `http://192.168.1.10:3001`).
4. Development server only: `npm run dev:tier34` (port 3001).

## Android APK

### Requirements

- Node.js 20+
- JDK 17+ (set `JAVA_HOME`)
- Android SDK (via Android Studio or standalone)

### Build steps

```bash
npm install
npm run build:client
npx cap sync android
npm run build:android:apk
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Install on device

Enable "Install from unknown sources" in Android Settings.
Transfer APK via USB cable or shared folder.
Tap to install.

### First-time setup on phone

1. Open app and complete profile onboarding.
2. **Server setup** screen — scan LAN, enter your desktop/NAS Sandbox Server URL, or skip for locker-only.
3. Same Wi‑Fi as the server host (or use overlay URL from Settings → Vault).
4. Check **Settings → Diagnostics → System Status** for connection health.

### Features without Sandbox Server

- Locker playback works fully offline on the device.
- Catalog search uses network metadata (previews).
- Downloads, acquire, Connect, and locker sync require Sandbox Server running somewhere on your network.

## Honest sync note

- **Locker local play:** works on each device without any server.
- **Full catalog streams / downloads / mesh feed / Connect / locker file sync:** need Sandbox Server reachable on the network (can be this PC, another device, or NAS — not necessarily the same machine you are listening on).
