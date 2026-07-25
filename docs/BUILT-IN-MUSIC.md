# BUILT-IN-MUSIC.md — The Sovereign Audio & Listening Session Constitution

> Source: authored by Gemini/ChatGPT as an aspirational architecture document.
> Stored here as reference / north-star. It describes an idealized "Sandbox OS"
> target architecture that the current app does not fully implement. See
> [MUSIC-STATION-GAP-ANALYSIS.md](./MUSIC-STATION-GAP-ANALYSIS.md) for how the
> real codebase aligns with and diverges from this document.

## Document Metadata

- Type: Station Constitution
- Status: Active
- Version: 1.0.0

## 1. Scope & Conformance

This document defines the constitutional responsibilities, ownership boundaries, capability contracts, and architectural invariants of the Music Station.
Canonical state is defined as the minimum authoritative state required to preserve constitutional behavior across implementation replacement.
Implementation details belong in Architecture Decision Records (ADRs), Engineering Specifications, and Reference Implementations.
The key words SHALL, SHALL NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as described in RFC 2119.

## 2. Constitutional Inheritance

This document SHALL conform to the constitutional governance hierarchy defined by `BUILT-IN-PLATFORM.md`:

1. Platform Constitution
2. Station / Service Constitutions
3. Architecture Decision Records (ADRs)
4. Engineering Specifications
5. Reference Implementations

Lower levels SHALL conform to higher levels. Authority not explicitly delegated by this Station Constitution SHALL remain with the Platform Constitution.

## 3. Constitutional Principles

- Media-Domain Ownership: The station owns domain-specific semantics, library curation, and playback state.
- Local-First Playback: Playback of available local media is guaranteed regardless of network or external service availability.
- Session Continuity: Playback state is preserved structurally across context switches and format changes.
- Platform Separation: The station remains strictly decoupled from storage, cryptography, and network implementations.
- Provider Replaceability: External media sources are opaque, replaceable adapters that never dictate canonical behavior.

## 4. Purpose & Vision

The Music Station is a sovereign, unified audio player designed to handle short-form stateless audio (music) and long-form stateful audio (podcasts, audiobooks) without format contamination. It acts as a specialized client to Sandbox OS foundation services, managing media domains, playback policies, and modular audio processing.

## 5. Ownership Matrix

| Concern | Constitutional Owner | Notes |
| --- | --- | --- |
| Listening Session State | Music Station | Canonical playback context |
| User Media State | Music Station | Playlists, subscriptions, bookmarks, favorites, playback history |
| Semantic Media Metadata | Music Station | Canonical user-visible metadata and annotations; excludes immutable media assets and encoded media bytes |
| Audio DSP Policies | Music Station | Playback-domain behavior |
| Playback Policy | Music Station | Canonical playback behavior |
| Audio Output Execution | Shell | Platform capability |
| Canonical Media Assets | Canonical Storage | Media bytes and immutable media objects |
| Search | Index | Derived capability |
| Household Sync | tier34 | Opaque transport only |
| Secrets | Vault | Music never owns keys |
| Hardware Audio Focus | Shell | Platform capability |

## 6. Security & Trust Boundaries

The Music Station SHALL NOT:

- Retain platform cryptographic secrets.
- Perform authentication independently.
- Bypass Platform authorization.
- Inspect opaque Vault payloads.
- Elevate privileges outside delegated Platform capabilities.

All cryptographic credentials, session signatures, and encryption routines remain strictly under the custody of `Vault`.

## 7. Constitutional Boundaries & Non-Goals

The Music Station SHALL remain a media-domain station.
The Music Station SHALL depend only upon Platform Foundation capability contracts and SHALL NOT depend upon implementation details of peer Stations.
Dependency Direction Rule: Platform Foundations SHALL NOT require the existence of the Music Station in order to satisfy their constitutional responsibilities.

Non-Goals — the Music Station SHALL NOT become: a general-purpose media server, a synchronization service, a storage service, a search engine, an identity provider, a networking stack, or a cryptographic authority.

It SHALL NOT: own canonical media storage; crawl storage outside Platform capabilities; perform search indexing; implement synchronization protocols; own household identity; own cryptographic secrets; implement networking policy; perform privileged audio routing; expose hardware-specific playback APIs.

## 8. Domain Isolation & Media Libraries

The Media Library is partitioned into three independent domains without structural inheritance. No domain SHALL inherit persistence semantics from another media domain. Each domain manages its own indexing rules and collections:

- `MusicLibrary`
- `PodcastLibrary`
- `AudiobookLibrary`

A single canonical metadata schema spanning all media domains SHALL NOT exist. Domains MAY expose a shared rendering interface (`MediaMetadata`) while retaining independent domain-specific schemas (e.g., `artist` for music, `chapterMap` for audiobooks).

## 9. Listening Sessions (Canonical State)

The Listening Session constitutes the sole mutable runtime playback state of the Music Station.
Queues, resume positions, DSP preferences, bookmarks, playback speed, and output routing SHALL belong to a Listening Session rather than to the application as a whole. Only one Listening Session MAY be active per user context at any time.
When switching domains, the active session is suspended (preserving its exact state) and the requested session is mounted. User playback state, playlists, subscriptions, bookmarks, favorites, and listening sessions constitute canonical Music Station state regardless of persistence mechanism.

## 10. Playback Policy & Engine Execution

The Music Station owns policy. The engine executes policy. The Shell owns hardware:
`Playback Policy` → `Playback Engine` → `Shell Audio Capability`

The unified `Playback Engine` executes domain-specific policies:

- `MusicPolicy`: Gapless, crossfade, ReplayGain, reset position (tracks restart at 0:00).
- `PodcastPolicy`: Resume, silence skip, transcript sync.
- `AudiobookPolicy`: Resume, bookmarks, notes, chapter memory.

The DSP chain is modular and dictated by the active Listening Session (e.g., `Decoder` → `ReplayGain` → `EQ` → `Dialogue Boost` → `Limiter` → `Output`).

## 11. Media Providers

Media acquisition SHALL occur through replaceable Media Provider implementations.
Provider implementations SHALL NOT affect Listening Session semantics. Media Providers SHALL NOT directly mutate canonical Music Station state nor bypass Music Station domain services. All mutations SHALL occur through Music Station domain services.
The library remains entirely agnostic to where media originates.

## 12. Capability Contracts

The Music Station relies entirely on the Global Capability Registry for internal and external functionality. The Station SHALL NOT directly depend upon implementation-specific APIs of Platform Foundations.

### 12.1 Exported Capabilities

- Playback control (play, pause, seek)
- Queue management
- Session management
- Lyrics and metadata lookup

### 12.2 Consumed Capabilities

- Canonical media access and discovery
- Cryptographic services
- Synchronization transport
- Audio output execution
- Cross-domain search
- AI-derived capabilities

## 13. Binding Invariants

1. Domain Isolation Invariant: Music, podcasts, and audiobooks SHALL remain structurally independent.
2. Session Preservation Invariant: Switching domains SHALL preserve the suspended Listening Session.
3. Stateless Music Invariant: Music playback SHALL restart unless explicitly overridden.
4. Stateful Spoken Audio Invariant: Podcasts and audiobooks SHALL resume by default.
5. Provider Replaceability Invariant: Changing Media Providers SHALL NOT alter Listening Session state.
6. AI Independence Invariant: Playback SHALL continue when AI capabilities are unavailable.
7. Search Independence Invariant: Playback SHALL continue when Index is unavailable.
8. Foundation Separation Invariant: The Music Station SHALL remain independent of Platform Foundation implementation details and SHALL interact exclusively through capability contracts.
9. Capability Contract Invariant: Capability contracts constitute the sole normative interface between the Music Station and Platform Foundations.
10. Offline Playback Invariant: Playback of locally available media SHALL remain possible without Index, tier34, network connectivity, or AI capabilities.

## 14. Derived State

The following SHALL be treated as derived state: playback queues generated from playlists; recommendation models; provider synchronization caches; provider discovery caches; artwork caches; waveform indexes; transcript caches; search caches; temporary provider metadata.

Derived state MAY be discarded and reconstructed at any time without data loss.
Playback history constitutes canonical Music Station state. Any analytics, recommendations, summaries, or statistics derived from playback history SHALL be treated as derived state.

## 15. Failure & Recovery

Failure of Platform Foundation capabilities or consumed capabilities (including `Index`, `tier34`, AI capabilities, or external `Media Providers`) SHALL NOT terminate local playback.

Failure SHALL NOT: discard Listening Sessions; reset playback position; modify canonical metadata owned by the Music Station; modify playlists or subscriptions; invalidate bookmarks; corrupt playback policy; alter canonical Music Station state or persistent provider configuration; prevent creation/modification/persistence of Music Station canonical state; escalate privileges.

Unavailable capabilities MAY reduce functionality but SHALL NOT terminate active playback of available local media.

## 16. Evolution Constraints

Constitutional provisions SHALL remain implementation-independent and technology-neutral.
Any modification to constitutional responsibilities, ownership boundaries, invariants, or capability contracts SHALL require an ADR and SHALL increment the Constitution version.

## 17. References

Normative: `BUILT-IN-PLATFORM.md`, `BUILT-IN-TIER34.md`, `BUILT-IN-VAULT.md`, `BUILT-IN-SHELL.md`.
Governance: `DECISIONS.md`.
Informative: `docs/MUSIC-STATION.md`, `sandbox-os-core/docs/PLATFORM-API.md`.
