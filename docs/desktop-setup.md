# Desktop setup: installer vs first launch

Windows desktop builds ship an NSIS `.exe` installer with Sandbox Music branding (dark void `#07080c`, burnt orange `#D8590A` highlights and `#B84708` outlines in sidebar/header art in `src-tauri/nsis/`).

## What you see in `setup.exe`

Short flow — **3 clicks** after launch (Welcome → Installing → Finish):

1. **Welcome** — Sandbox Music overview and first-launch checklist. Custom text in `src-tauri/nsis/English.nsh`.
2. **Installing** — file copy + silent WebView2 bootstrapper if needed.
3. **Finish** — optional desktop shortcut, launch app. Reminder that locker + server are configured on first launch.

**Skipped by design** (no white NSIS panels):

- Already-installed / maintenance chooser — re-runs **upgrade in place** automatically.
- Install location — `%LOCALAPPDATA%\Sandbox Music` (per-user, no UAC). Main app binary: `Sandbox Music.exe` (set via `mainBinaryName` in `src-tauri/tauri.conf.json`).
- Start Menu folder picker — shortcuts go to **Sandbox Music** in Start Menu.

To **fully remove** the app (not just upgrade), use Settings → Apps or run `uninstall.exe` from the install folder.

Installer art: `header.bmp`, `sidebar.bmp` (regenerate with `python scripts/generate-nsis-assets.py`).

## What you see on first app launch

After install, opening the app shows:

1. **Boot splash** — dark `#07080c` background, Sandbox icon, orange loading bar (inline in `index.html` before React mounts). Avoids white flash in Tauri/WebView2.
2. **Short onboarding** (desktop only, once) — welcome plus functional setup; profile name, taste seeds, and finish screens are skipped on desktop:
   - **Welcome** — what Sandbox Music does (locker, playback, optional server)
   - **Locker** — folder picker for downloads/imports
   - **Server** — off / remote URL / anchor mode
   - **Cast** — Sonos/UPnP in-app; Chromecast via browser
   - **Node** — device fingerprint for the mesh (copy optional)
3. **Home** — main console after finishing onboarding.

Web and mobile builds keep the full in-app onboarding (welcome, profile name, taste seeds, locker, server, finish).

## Rebuild desktop installer

```bash
npm run prebuild:desktop:assets   # NSIS bitmaps + icons (first time or after theme change)
npm run build:desktop             # static client + Tauri bundle (.msi + .exe)
```

Output: `src-tauri/target/release/bundle/nsis/*.exe` and `msi/*.msi`.

## Verify the running app (not stale build output)

After install, **launch from** `%LOCALAPPDATA%\Sandbox Music\Sandbox Music.exe` (Start Menu or desktop shortcut). Do not run `src-tauri/target/release/Sandbox Music.exe` directly — that folder is build output only and is easy to confuse with the installed copy.

Confirm you picked up the latest build: the window title includes a fresh **BUILD_ID** timestamp, e.g. `Sandbox Music [sm-2025-06-12T17:43:00.000Z]`.

## Reset first-run (testing)

In dev tools console: `localStorage.removeItem('sandbox_onboarding_complete')` then reload, or use Settings if a reset control is exposed.
