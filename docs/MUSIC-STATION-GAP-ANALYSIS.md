# Music Station — Constitution vs. Reality (Gap Analysis)

Honest assessment of how the current codebase (`sovereign-music-console`, a
React + Capacitor + native-ExoPlayer app) aligns with the aspirational
[BUILT-IN-MUSIC.md](./BUILT-IN-MUSIC.md) constitution and
[MUSIC-UI-HOLY-TRINITY.md](./MUSIC-UI-HOLY-TRINITY.md) UI spec.

**Bottom line:** the app does not implement the formal "Sandbox OS platform +
capability registry + stations" structure, and does not need to in order to
work. But several of the *behavioral invariants* are already true — and are
worth protecting as guardrails. A handful of gaps are cheap, user-visible wins;
the rest are large structural rewrites with little user benefit today.

Legend: ✅ already honored · 🟡 partial · ⬜ not present · 🔴 divergent by design

## Behavioral invariants (the parts worth keeping)

| Constitution invariant | Reality in this codebase | Status |
| --- | --- | --- |
| Offline Playback (§13.10) — local media plays with no network/AI/index | Native ExoPlayer plays `content://` locker blobs offline; `healLockerEntryNativePlayback` is native-first. The storage-reclaim work explicitly preserved this. | ✅ |
| Derived state is discardable (§14) — caches, recommendations, artwork | Artwork caches, discovery caches, genre-enrich cache, taste profile, search caches are all rebuildable; reclaim/eviction relies on this. | ✅ |
| AI / Search independence (§13.6–13.7) | Playback never depends on iTunes/Last.fm/MusicBrainz/tier34; those only enrich. | ✅ |
| Local-First Playback (§3) | Yes — the whole locker/native-blob design. | ✅ |
| Stateless Music vs. Stateful spoken audio (§13.3–13.4) | Music restarts at 0:00; podcasts/audiobooks resume (`PodcastPolicy`/audiobook resume logic exists). | 🟡 close |
| Domain Isolation (§8, §13.1) — music/podcast/audiobook independent | Separate catalogs/views (`lockerStorage`, `podcastCatalog`, `audiobookCatalog`) and separate nav, but they share some infra and a single player, not three structurally-isolated libraries. | 🟡 |
| Provider Replaceability (§11, §13.5) | Search/enrichment providers (iTunes, Last.fm, Deezer, MusicBrainz, YouTube, Archive) are swappable adapters; but they call into shared modules directly, not through a formal provider contract. | 🟡 |
| Session Preservation across domain switch (§9, §13.2) | Playback/queue state persists (`queuePersistence`, `lastPlayIntent`), but there isn't a first-class "Listening Session" object per domain that suspends/mounts. | 🟡 |

## Structural elements (the parts we don't have — and mostly don't need)

| Constitution element | Reality | Status | Worth doing? |
| --- | --- | --- | --- |
| Global Capability Registry (§12) — all cross-module calls via contracts | Direct ES imports + Capacitor plugins. | ⬜ | No — large rewrite, no user benefit. |
| Platform Foundations: Vault / Shell / Index / tier34 as formal services (§2, §5) | tier34 server is an optional sync/proxy; no Vault/Shell/Index services. Secrets = build-time keys + user-entered keys, not a Vault. | ⬜ / 🔴 | No — this app is a single client, not an OS. |
| ADR governance hierarchy (§2, §16) | No ADRs; changes land directly. | ⬜ | Optional — lightweight ADRs could help, but not required. |
| First-class `ListeningSession` object (§9) | State is spread across queue/history/intent modules. | 🟡 | Maybe — a refactor to consolidate could reduce bugs, medium effort. |
| Formal `MediaProvider` interface (§11) | Ad-hoc adapters. | 🟡 | Maybe — a thin interface would make adding sources cleaner, low-medium effort. |

## UI spec ("Holy Trinity") vs. current UI

| UI requirement | Reality | Status |
| --- | --- | --- |
| Three persistent contexts, no queue cross-contamination (§3, §9) | Music / Podcasts / Audiobooks exist as separate surfaces; a single active player. Queue isolation is mostly true but not formally guaranteed per-domain. | 🟡 |
| Mini / Now-Playing / Immersive player modes (§5) | Mini-player + expanded Now Playing exist. No dedicated "Immersive" waveform mode. | 🟡 |
| Smart Speed Memory per domain (§4) | Podcast/audiobook speed exists; per-domain persistence not unified. | 🟡 |
| Universal search grouped by domain (§4) | Search exists across sources; grouping-by-domain is partial. | 🟡 |
| Ambient "Water Slider" mixer (§6) | Not present. | ⬜ |
| Progressive disclosure of EQ/ReplayGain (§7) | EQ / stem / vinyl controls exist but not organized exactly as specified. | 🟡 |
| Operable without artwork/animation/network metadata (§10) | Largely true — gradient fallbacks, offline metadata. | ✅ |

## Recommendation

1. **Adopt the invariants as guardrails, not the structure as a mandate.** Treat
   §13 (esp. Offline Playback, AI/Search Independence) and §14 (Derived State) as
   rules we already follow and must not regress. They caught real risk in the
   storage-reclaim work.
2. **Skip the platform/registry rewrite.** Capability registry, Vault/Shell/Index
   foundations, and ADR governance are appropriate for a multi-app OS, not a
   single Capacitor client. No user-facing benefit.
3. **Cheap wins if desired, in priority order:** a thin `MediaProvider` interface;
   consolidating playback state into one `ListeningSession`-shaped module;
   formal per-domain queue isolation. Each is optional and independent.
4. **Do not block current bug-fixing on any of this.** Downloads, artwork, and
   album-grouping fixes deliver more value right now.
