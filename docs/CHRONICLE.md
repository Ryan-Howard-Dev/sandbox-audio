# Chronicle — Sandbox Music design log

Working memory for **Sovereign Music Console**. Append after meaningful build/design sessions so context does not live only in chat.

**Source:** Reconstructed from Cursor agent transcript `59955f80-…` (full chat arc) + July 2026 sessions. Dates for May–June are approximate where git history is unavailable.

**OS / marketplace / funding:** `C:\Users\RH\Downloads\sandbox-os\docs\CHRONICLE.md`  
**Immutable decisions:** `sandbox-os/docs/DECISIONS.md`  
**Builder (Conduit):** `C:\Users\RH\Downloads\sandbox-conduit (1)` — see `sandbox-os/docs/CONDUIT-LINK.md`

---

## How to maintain

1. Add `## YYYY-MM-DD — Title` per session.  
2. Bullet: **asked**, **decided**, **shipped**, **deferred**, **key files**.  
3. Link to `sandbox-os` chronicle when scope exceeds music.

---

## 2026-05 (~) — Bootstrap

- **~6 weeks** (founder estimate) to multi-platform music console.  
- Targets: Web/PWA, Android (Capacitor), Tauri desktop, **tier34 Sandbox Server**.  
- Scale (2026-07): ~567 TS/Rust files, ~120k LOC.

---

## 2026-06 (early) — Playback stability & E2E

**User goals:** Stable play on WiFi/3G/4G/5G; locker + playlists + streams; full tracks not snippets; album queue advance; no wrong-track jumps; no crashes.

| Theme | Work |
|-------|------|
| 3-track album queue | E2E Bully album sequence; Exo early-pause fixes; sequential `play-album-track` path |
| Kanye validation suite | FATHER/KING track identity, 25s monotonic progress, vinyl toggle |
| Network matrix | Stream/locker paths; iterative fixes |
| Guide haptics | Buzz only on tester button, not on guide start |
| Vinyl vs Windows | Keep DMT/trip effects Windows-only; differentiate platforms |

**Outcome:** Emulator runs reached **5/5 PASS** (Kanye suite run 14). Network matrix needed re-runs after further fixes.

**Key areas:** `sandboxLayer3.tsx`, `e2eDevAction`, `e2ePlaybackWait`, Android Exo bridge, `scripts/*e2e*`

---

## 2026-06 — Mini player, notifications, follow polling

| Feature | Decision |
|---------|----------|
| Mini bar stability | Same Exo pipeline across tabs; hidden on Home (vinyl/art hero) |
| Tap notification / lock screen | Navigate to **Home** vinyl/art for playing track |
| Mini bar artist tap | Menu: artist page vs album; elsewhere → Home player |
| Followed artist releases | Polling for new albums/singles + Discover badge + background notification |
| Battery concern | User rejected aggressive polling; settled on **12-hour** check interval |

**Key files:** `playerDeepLink.ts`, `usePlayerHomeNavigation.ts`, `followedReleasePolling.ts`, `followedReleaseBackgroundSchedule.ts`

---

## 2026-06 — Full review, CI, architecture

**Review findings (addressed or planned):**

| Issue | Action |
|-------|--------|
| `sandboxLayer3.tsx` monolith (~6k lines) | Split hooks: `useShellDiscoverBadge`, `usePlayerHomeNavigation`, `useAndroidShellBridges`; lazy station chunks |
| Tests not in CI | `npm test` added to CI workflow |
| E2E emulator-only | Phone E2E scripts; release gating discussed |
| 2.5 MB main bundle | Code-split stations → ~312 KB main; Discover ~1.47 MB lazy chunk |
| P0 forensic list | E2E deep links gated DEV; locker lazy blob read; FSM heal try/catch; quota-safe prefs; Exo try/catch; error boundaries; API 33+ receivers; etc. |

**Tests:** Vitest suite grew (184→192+ tests); playback/pipeline/resolver coverage.

---

## 2026-06 — Device testing (phone USB)

**Pain reported:** Play not full length; progress jumps to start; vinyl toggle broken; crashes; bottom tab overlaps Android system nav; vinyl not centered; art screen overlaps vinyl button; lag on uncached streams (Ghost Dae); only cached tracks used in agent tests.

| Fix theme | Detail |
|-----------|--------|
| Stream-first playback | Stop double full yt-dlp download before play; background cache while streaming |
| `androidPreferWatchForFullTrack` | Gate/remove forced watch-URL full downloads |
| Safe area / insets | Tab bar + mini player above system nav; repeated user feedback until fixed |
| Tidal-style player sheet | Expandable now-playing; simpler controls in Sandbox art style |
| Phone E2E | `scripts/phone-playback-vinyl-e2e.ps1` on device `46349770`; logcat `[handlePlayEnvelope]` |

**Lesson captured:** Emulator + cached tracks ≠ real cellular lag; must test uncached streams on physical device.

---

## 2026-06 — “World-class player” lanes

**Lane A (recommended):** Best **sovereign locker player** — own music, syncs silently, never phones home.

| Priority | Initiative |
|----------|------------|
| P0 | Locker sync Phase 3 (background sync, delete tombstones, conflict UI) |
| P0 | Signed Android release + F-Droid |
| P0 | Playback spine tests + release E2E gate |
| P1 | Split shell further; virtualize large lists |
| P1 | Exo crossfade + proper ReplayGain |
| P1 | “Prepare for travel” Wi‑Fi prefetch |
| P2 | Android widget; playlist import → auto-acquire |

**Lane B:** Streaming-first competitor (deferred / broader).

**Other bars discussed:** PWA mobile shell &lt;768px; cellular play without home LAN unless overlay (Headscale); gapless + crossfade on Exo without WebView fallback.

---

## 2026-06 — Locker UX & platform import

| Item | Shipped / noted |
|------|-----------------|
| Artist-first locker | Artists tab default; drill artist → albums/singles |
| Album cover backfill | Blob store in `readLockerEntriesFromDb`; `repairLockerVault` |
| Search history v2 | Round artist / square album thumbs in recent search |
| Green flash on artist tap | Removed `seedGradient` hero; neutral placeholder + fade-in |
| Platform import | Spotify paginated, Deezer, YT Music, SoundCloud, others best-effort |
| Podcast tab | In scope of locker/collection work |

**Key files:** `LocalView.tsx`, `LockerArtistGrid.tsx`, `lockerStorage.ts`, `searchHistory.ts`, `CollectionView.tsx`

---

## 2026-07-07 — Locker artist page vs Tidal

**Question:** Does locker artist match Tidal (bio, top tracks, grids)?

**Built:**

| Feature | Files |
|---------|-------|
| Radio / Follow / Share | `LockerArtistProfile.tsx` |
| Top Tracks (play-count sorted) | `LockerArtistHub.tsx`, `lockerArtistHub.ts` |
| Album/Singles 2-wide carousels + View all | `LockerArtistHub.tsx`, CSS |
| Credits aggregation | `lockerArtistHub.ts` |
| Hub replaces flat grid | `LocalView.tsx` `showArtistHub` |

**Deferred:** Global fan count (needs federation or external API).

---

## 2026-07-07 — Cross-repo (OS, not music code)

Discussed in same chat thread; documented in `sandbox-os`:

- Server sync for follows; server-to-server federation; full OS; marketplace on lockers; banking vault; voting; repo split; chronicle discipline; funding with full-time job.

Music remains **Station #1** + tier34 reference implementation.

---

## Stable architecture index

| Topic | Location |
|-------|----------|
| Server | `docs/sandbox-architecture.md`, `TIER34.md` |
| Locker sync gaps | `LOCKER_SYNC.md` |
| Federated taste | `docs/federated-taste.md` |
| Android playback | `docs/android-playback.md` |
| Infrastructure scaffold | `docs/INFRASTRUCTURE.md` |
| Follows (local) | `src/followedArtists.ts` |
| Play history / top tracks | `src/playHistory.ts` |

---

## Recurring risks (from chat)

1. **Playback regressions** — tap → resolve → play → advance; test on **real phone**, uncached tracks.  
2. **Mobile layout** — safe-area, system nav overlap, vinyl/art toggle visibility.  
3. **Monolithic shell** — ongoing split of `sandboxLayer3.tsx`.  
4. **CI gap** — unit tests in CI; phone E2E as release gate still aspirational.  
5. **Scope** — OS/marketplace vision must not block Lane A music stability.

---

## Open items (music)

- [ ] Phone E2E gate on every release build  
- [ ] Locker sync Phase 3 complete  
- [ ] Signed Android + F-Droid pipeline  
- [ ] Sync `followedArtists` to tier34  
- [ ] Safe-area audit on all mobile screens (user-reported overlaps)  
- [ ] Exo crossfade + gapless without WebView  
- [ ] Verify locker artist hub on device after latest APK  
- [ ] PWA responsive shell &lt;768px (if iOS not planned soon)

---

## Session index (user queries → topic)

| Approx. order | User focus |
|---------------|------------|
| 1 | Developer / files OK |
| 2 | Network stability, vinyl, downloads, guide haptics |
| 3 | 3-track queue FAIL → fix until green |
| 4 | Mini player all tabs; lock screen → Home |
| 5 | Artist menu on mini bar; follow notifications |
| 6 | 12h polling not 60s |
| 7 | Full review; CI; split shell; bundle size |
| 8 | P0 forensic hardening list |
| 9 | Phone USB test; playback length; vinyl toggle |
| 10 | Player controls layout; Tidal sheet; safe area |
| 11 | Stream lag uncached; Ghost Dae |
| 12 | Lane A roadmap; locker sync; F-Droid |
| 13 | Locker artist-first; Tidal; search images |
| 14 | Locker artist hub features; OS/federation/marketplace |
| 15 | Chronicle for both repos; funding / job time |
| 16 | sandbox-conduit audit; DECISIONS.md; CONDUIT-LINK |
