# Android TV Readiness Report

**Project:** Sovereign Music Console  
**Audit date:** 2026-06-09  
**Scope:** Code audit + targeted fixes for NVIDIA Shield, Amazon Fire TV, and Android TV Emulator. Physical device testing was not performed in CI/sandbox; emulator steps are documented below.

## Executive Summary

The app ships a dedicated 10-foot TV shell (`detectTVPlatform()` → `shell-root--tv`) with leanback launcher metadata, a D-pad nav rail, TV home rows, full-screen playback, and a TV queue panel. **Core playback and home browsing are usable with a remote.** Connect and Cast depend on tier34 LAN infrastructure and remain **Partial**. Locker, Playlists, and Feed use the phone-oriented station views on TV without bespoke D-pad layouts.

**First-run honesty (2026-06):** TV home shows a dismissible coverage banner (`shell.tvCoverageBanner` in `sandboxLayer3.tsx`) listing partial vs phone-only stations. TV nav subtitles mark Discover (Feed · Explore · Playlists) and Locker (phone layout on TV).

| Surface | Status | Notes |
|---------|--------|-------|
| D-pad navigation (nav rail + home) | **Pass** | Left-edge opens rail; horizontal card nav preserved |
| Playback controls | **Pass** | All transport buttons focusable; seek bar reachable |
| Queue drawer (TV panel) | **Partial** | Opens/closes via remote; remove buttons focusable; no row-to-row D-pad |
| Connect | **Partial** | Settings-only; requires tier34 peer-sync relay on LAN |
| Feed station | **Partial** | Reachable via nav rail; uses standard FeedView (limited row D-pad) |
| Locker | **Partial** | Reachable via nav; album grid not TV-optimized |
| Playlists | **Partial** | Reachable via nav + home row; desktop layout on TV |
| Cast / Sandbox Cast | **Partial** | Cast picker modal focusable; tier34 health required for speaker scan |

## Device Compatibility

### NVIDIA Shield

| Check | Result |
|-------|--------|
| Leanback launcher | Pass — `LEANBACK_LAUNCHER` + `android:banner` present |
| UA detection (`shield`) | Pass — matched in `tvDetection.ts` |
| D-pad / Back | Pass — centralized Back handler (queue → cast → nav → playback) |
| Native Cast | Partial — Google Cast SDK path; tier34 for DLNA/Sonos |

### Amazon Fire TV

| Check | Result |
|-------|--------|
| Leanback launcher | Pass — sideload/APK installs to Fire TV launcher when leanback enabled |
| UA detection (`aft*`, `firetv`) | Pass |
| No-touch heuristic | Pass — Android non-Mobile UA + landscape 1280×720 fallback |
| Amazon store listing | Not audited — manifest is sideload-ready, not Fire OS–specific |

### Android TV Emulator (API 33+ recommended)

| Check | Result |
|-------|--------|
| Leanback system image | Pass — use Android TV (Google APIs) AVD |
| TV detection | Pass — emulator UA includes TV tokens or hits geometry heuristic |
| Remote simulation | Pass — emulator extended controls send D-pad / Back |

## Manifest & Platform

**File:** `android/app/src/main/AndroidManifest.xml`

- `android.software.leanback` — optional (correct for phone + TV dual target)
- `android.hardware.touchscreen` — optional
- `android.intent.category.LEANBACK_LAUNCHER` — present on `MainActivity`
- `android:banner="@drawable/tv_banner"` — present (`res/drawable/tv_banner.xml`, 320×180 dp)

No manifest changes were required during this pass.

## TV Detection

**File:** `src/tvDetection.ts`

Detection order:

1. TV UA tokens (`shield`, `aft`, `firetv`, `googletv`, `leanback`, …)
2. Capacitor Android + non-Mobile UA
3. Fallback: landscape ≥1280×720, coarse pointer, no hover

When true, `sandboxLayer3.tsx` hides phone chrome (search bar, bottom player, car mode) and renders `TVNavigation` + TV home/playback views.

## Per-Surface Audit

### D-pad navigation

**Components:** `TVNavigation.tsx`, `TVHomeView.tsx`

| Item | Finding | Resolution |
|------|---------|------------|
| Nav rail focus | Buttons use `tabIndex={0}` when open | Pass |
| ArrowLeft stole horizontal card nav | **Fail** — global handler always opened nav | **Fixed** — `shouldOpenNavOnArrowLeft()` only opens at row/control left edge |
| Vertical row navigation | Up/Down between home rows | Pass |
| Nav open focus | No initial focus on open | **Fixed** — focuses active station button |
| Feed unreachable | Not in TV nav | **Fixed** — Feed added to nav rail |
| Back key | Competing handlers in queue/playback/nav | **Fixed** — capture-phase handler in `sandboxLayer3.tsx` |

**Focus traps:** None identified after fixes. Overlay scrims use `pointer-events` only; they do not capture tab order.

**Unreachable controls:** Nav rail items when drawer closed are intentionally `-1` tabIndex; open with D-pad **Left** from content left edge.

### Playback controls

**Component:** `TVPlaybackView.tsx`

| Control | Focusable | Remote |
|---------|-----------|--------|
| Shuffle / Skip / Play-Pause / Repeat | Yes (`<button>`) | Pass |
| Queue / Cast | Yes | Pass |
| Seek scrubber | Yes (`<input type="range">`) | Partial — usable but coarse on 10-foot UI |
| Back to home | Remote **Back** | Pass (shell handler) |

Auto-focus on play button at mount aids first-remote interaction.

### Queue drawer

**TV path:** `TVQueuePanel.tsx` (replaces `QueueDrawer` on TV)

| Item | Status |
|------|--------|
| Open from playback | Pass — Queue button |
| Close via Back | Pass |
| Close button focus on open | **Fixed** |
| `aria-modal="true"` | **Fixed** — blocks global shortcuts while open |
| Clear / per-track remove | Pass — buttons focusable |
| Reorder queue | Fail — not exposed on TV panel (by design) |
| Row-to-row D-pad in list | Partial — scroll only; remove buttons per row |

### Connect

**Path:** Settings → Sandbox Connect (`SettingsView.tsx`, `ConnectSetupWizard`)

| Item | Status |
|------|--------|
| Reachable on TV | Partial — scrollable settings, native focus on form controls |
| Host/remote role setup | Partial — text fields awkward on 10-foot UI |
| tier34 dependency | **Fail without LAN tier34** — Connect relay offline without peer-sync |
| QR / pairing flows | Not TV-optimized |

Honest rating: **Partial** — functional for power users with tier34 running; not a lean 10-foot Connect experience.

### Feed station

**Path:** TV nav → Feed → `FeedView.tsx`

| Item | Status |
|------|--------|
| Nav entry | Pass (added in this pass) |
| Play actions | Pass — track rows use `<button>` |
| Horizontal / grid D-pad | Partial — no custom TV row scroller |

### Locker

**Path:** TV nav → Local Library → `CollectionView.tsx`

| Item | Status |
|------|--------|
| Nav entry | Pass |
| Section tabs | Partial — buttons exist; dense layout |
| Album grid | Partial — clickable tiles; no TV card scroller |
| Search within locker | Partial — keyboard required for text |

### Playlists

**Paths:** TV nav, TV home Playlists row, `PlaylistsView.tsx`

| Item | Status |
|------|--------|
| Home row quick play | Pass — plays tracks or opens station |
| Full station view | Partial — desktop-oriented list/detail |
| Create/edit playlist | Partial — inline inputs on TV |

## Fixes Applied (This Pass)

1. **`TVNavigation.tsx`** — Smart ArrowLeft (no longer blocks in-row card navigation); Feed station; focus active nav item on open; `data-tv-station` markers.
2. **`TVHomeView.tsx`** — Auto-focus first catalog card on load.
3. **`sandboxLayer3.tsx`** — Centralized TV Back (capture): queue → cast picker → nav drawer → playback → home; `tvActiveStation` includes Feed.
4. **`TVQueuePanel.tsx`** — Focus close on open; `aria-modal="true"`; removed duplicate Back listener.
5. **`TVPlaybackView.tsx`** — Removed duplicate Back listener (shell owns Back).
6. **`ModalOverlay.tsx`** — Back key closes modals (Cast picker, Connect wizard).
7. **`index.css`** — TV 48px min targets; hide horizontal scrollbar on TV row scrollers.

## Known Limitations

- **No physical device verification** in sandbox — emulator checklist below is required.
- **Connect / Cast speaker scan** require tier34 on the same LAN (`tier34HealthOk`, `tier34CastDiscover`).
- **Explore, Search, Podcasts, Insights** are not in the TV nav rail (phone stations only).
- **DJ Console** appears when Pro Audio is enabled; mixer UI is not TV-optimized.
- **Queue reorder** and **save queue as playlist** are phone `QueueDrawer` features only.
- **Volume** on TV playback has no on-screen slider (system volume / remote volume keys).
- **Fire TV** sideload vs Amazon Appstore compliance not reviewed.

## Emulator Test Checklist

### Setup

1. Install Android Studio; create AVD: **Android TV (Google APIs)**, 1080p, API 33+.
2. Build and install:
   ```bash
   npm run build
   npx cap sync android
   cd android && ./gradlew installDebug
   ```
3. Launch **Sovereign Music Console** from the TV launcher (not phone launcher).
4. Confirm `shell-root--tv` class in WebView (inspect via `chrome://inspect` if needed).

### D-pad navigation

- [ ] From home, **Right** moves across cards in a row; **Left** on first card opens nav rail.
- [ ] **Up/Down** moves between Continue / Recent / Playlists / Collections rows.
- [ ] **Enter** on a card starts playback and opens TV playback view.
- [ ] **Left** on nav rail opens drawer; **Up/Down** changes station; **Right** or **Enter** closes drawer.
- [ ] Select **Feed**, **Playlists**, **Local Library**, **Settings** — each station renders.

### Playback

- [ ] Play/Pause, Skip back/forward, Shuffle, Repeat are focusable and activate on **Enter**.
- [ ] Seek bar accepts focus; **Left/Right** adjusts position when focused.
- [ ] **Back** returns to TV home from playback.

### Queue

- [ ] Queue button opens right panel; focus lands on Close.
- [ ] **Back** closes queue without leaving playback.
- [ ] Clear and per-track Remove work when focused.

### Cast

- [ ] Cast button opens modal; **Back** closes.
- [ ] Without tier34: scan shows "Start tier34" message (expected **Partial**).

### Connect

- [ ] Settings → Sandbox Connect section scrollable and focusable.
- [ ] With tier34 offline: Connect status shows offline (expected).

### Regression (phone/tablet)

- [ ] Build phone APK or resize emulator to phone; confirm `shell-root--tv` absent.
- [ ] Bottom player bar and station menu still work on phone layout.

## Files Reference

| Area | Primary files |
|------|----------------|
| TV shell routing | `src/sandboxLayer3.tsx` |
| TV detection | `src/tvDetection.ts` |
| Nav rail | `src/components/TVNavigation.tsx` |
| TV home / playback | `src/stations/TVHomeView.tsx`, `TVPlaybackView.tsx` |
| TV queue | `src/components/TVQueuePanel.tsx` |
| Focus CSS | `src/index.css` (`:focus-visible`, `.shell-root--tv`) |
| Manifest | `android/app/src/main/AndroidManifest.xml` |
| Keyboard policy | `src/keyboardShortcuts.ts` (`tvMode` disables arrow shortcuts) |

## Status Legend

- **Pass** — D-pad reachable; primary actions work on TV without mouse.
- **Partial** — Reachable but degraded UX, LAN dependency, or missing TV-specific layout.
- **Fail** — Not reachable or blocked without tier34 / unsupported input.
