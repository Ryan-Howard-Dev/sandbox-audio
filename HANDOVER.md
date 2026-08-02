# Handover — Sandbox Music

**Written:** 2026-07-29
**Branch:** `fix/lock-screen-media-session-and-ui`
**Read this before changing anything.** It records what was measured versus what was only compiled,
which is not the same thing and cost two days to learn.

---

## The one rule this session earned

**Run something. Do not reason about behaviour you can observe.**

Every real finding came from executing, not reading:

| how it was found | what it found |
|---|---|
| device timing log | 14.1s resolve was a *failure and retry*, not one slow call |
| `[catalogTrace]` log | search dropped the canonical row before ranking ever ran |
| fuzz test | cache stored URLs that were already expired |
| compile gate | 2,010 parse errors nobody knew about (wrestling repo) |

Five diagnoses of the search bug were made by reading code. All five were wrong. The sixth was made
by printing the list, and took one run.

**A corollary:** a stale WebView bundle silently served old JavaScript for several rounds, so three
fixes appeared not to work and were re-diagnosed as new bugs. If a change seems to do nothing,
**verify the build is live before doubting the change.**

---

## Verified on a real device

Measured on the connected phone, not inferred.

- **Online resolve 14.1s → ~5.5s.** The old cost was a failed audio-only attempt plus a slower
  fallback. `yt-dlp` format selector now accepts progressive streams.
- **yt-dlp self-updates** at boot — confirmed `status=DONE version=2026.07.04`, rate-limited weekly.
- **Fidelity badge is honest** — `bitrateKbps=96` on a live online track. See caveat below.
- **Audiobook compressor runs natively** — `ExoSpeechClarity: engaged threshold=-24.0 ratio=3.0`.
- **Search returns the real recording** — `Radiohead — Weird Fishes / Arpeggi` at rank 0, and the
  play path picks the same row it displays.

## Compiles, never run

Treat as unproven.

- **tier34 TIDAL route** (`tier34-server/routes/tidal.ts`) — no request has ever gone through it.
- **RRF fusion in the Tracks tab** (`SearchResultsView.tsx`) — that branch did not trigger for the
  query used to test.
- **Karaoke/derivative filter** — unit-tested, never seen against a live catalog response.
- **Dead-URL cache guard** — found by fuzzing, never exercised live.

## Known broken

- **The player's clock was frozen at 0:00 on every track.** Audio played; the timer never moved
  and the scrubber never left the left edge, on music and audiobooks alike. The wait for native
  to confirm which envelope it had loaded could only be released by an exact envelope-id match,
  and native frequently reports none, so every poll pinned the position back to zero for the
  whole track. **Fixed** in `exoAwaitConfirm.ts` and verified on the OnePlus: two frames twelve
  seconds apart read 0:16 and 0:30. Note that 261 test files were green throughout, and four
  store screenshots were taken of the frozen player without anyone noticing.
- **Every online track is 96 kbps AAC** inside a 360p video (itag 18). YouTube serves no audio-only
  format to this extractor on any player client — `ios`, `web_safari`, `mweb` and `android` were all
  tested. Not a code bug. The badge tells the truth about it.
- **Ranking below rank 0 is imperfect** — a karaoke row outranked an artist's own remix before the
  derivative filter; re-check now that it exists.

## Was built and never wired — both are wired now

Kept here rather than deleted, because this section claimed for a long time that these were the
highest-value unfinished work, and at least one downstream review inherited that and repeated it.
Check the tree before trusting a list like this one, including this line.

- **`lockerAudiobookChapters`** — M4B chapter parsing (seek-to-`moov`, `chpl` at 100ns ticks,
  range reads so a 5 GB book never loads into memory). **Wired**: `EmbeddedChapterList` calls it
  and is mounted in `AudiobooksView.tsx`.
- **`planCalibreImport`** — folder-tree Calibre import, correctly refuses `metadata.db`.
  **Wired**: `BookShelf` plans a picked folder through `planCalibreLibraryFiles` behind a
  `webkitdirectory` picker. A second route now exists over OPDS for a calibre-web server, which
  is the case the folder import could never cover: the library on a machine that is not this one.

---

## Diagnostics in the build — use these first

All present and cheap. They answer in one run what reading answers wrongly in five.

| log tag | tells you |
|---|---|
| `[playTiming]` | tap → execute-start → resolved → loadEnvelope, with ms |
| `[resolveTiming]` | how long native stream resolution took, and what kind of URL |
| `[tryInstantPlayable]` | why a play was instant or paid full price |
| `[handleSearchPlay]` | what was picked, and out of how many sources |
| `[catalogTerm]` / `[catalogTrace]` / `[unifiedTracks]` | search: what each term returned, what survived each stage, what rendered |
| `AREA=playback-probe` | UI vs native identity, and whether they agree |

Read them with:

```bash
adb logcat -d | grep -E "playTiming|catalogTrace|tryInstantPlayable"
```

`logPlayTiming` was `DEV`-gated for its whole life, so it had **never run on a phone** until this
session. If you add instrumentation, do not gate it to DEV — the behaviour it measures only exists
on device.

---

## Build and verify

```bash
npx tsc --noEmit                       # clean
npx vitest run                         # 233 files / 1700 tests, 0 failures (2026-07-31)
SANDBOX_ANDROID_E2E=true npm run build:android:apk
adb install -r android/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk
```

E2E deep links (debug builds only):

```
sandboxmusic://e2e/search?query=...
sandboxmusic://e2e/search-play?query=...&index=0
sandboxmusic://e2e/probe-playback
```

**The app must be foregrounded and awake.** Android freezes the WebView when backgrounded — a
frozen WebView records nothing, and silence looks identical to failure. Several hours were lost to
this.

---

## Security state

- TIDAL credential **purged from all git history** (161 commits rewritten, force-pushed).
  Backup mirror: `Downloads/smc-prefilter-backup-20260729-155154.git`.
- **Rotation is still required.** The key was public; assume it was scraped. Purging history closes
  the door, rotating changes the lock.
- Credentials now belong on the **tier34 server** (`TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`), never
  in a client build. `VITE_TIDAL_*` exists only for running without a server.
- Acquisition resolvers default **off**; `VITE_ACQUISITION_DEFAULT_ON=true` in `.env.local` restores
  full capability for a personal build. Nothing was removed.
- `LICENSE` and `package.json` both say GPL-3.0.

---

## Next, in order

1. **Retake the store screenshots.** The four in `fastlane/metadata/android/en-US/images/` were
   taken while the player's clock was frozen, so they show a bug. They also contain a real
   personal library, which is a decision to make deliberately before publishing.
2. **Verify the three unrun changes** on device: tier34 TIDAL route, Tracks-tab fusion, karaoke filter.
3. Rotate the TIDAL credential and put the new pair on tier34 only.

Done, and previously listed here:

- ~~Wire M4B chapters into the audiobook player~~ — `EmbeddedChapterList`, mounted.
- ~~Stop metadata leading playback~~ — `nowPlayingAuthority.ts` decides whose metadata may be
  painted, and reaches the lock screen and notification as well as the screen. 39 tests.

## Not on GitHub

`wrestling-booker`, `sandbox-conduit`, `sandbox-os-core` are local-only. Work on them cannot continue
from a phone or a cloud session until they are pushed.
