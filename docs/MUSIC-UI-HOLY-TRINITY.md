# UI-UX Specification: The "Holy Trinity" Audio Interface

> Source: authored by Gemini/ChatGPT as an aspirational UI specification.
> Stored here as reference. See [MUSIC-STATION-GAP-ANALYSIS.md](./MUSIC-STATION-GAP-ANALYSIS.md)
> for how the current UI aligns with and diverges from this document.

## 1. Scope & Authority

Defines the normative rendering behavior of the Music Station UI. Visual styling, animations, iconography, typography, branding, and spacing are implementation-defined provided the normative behaviors are preserved.

## 2. Constitutional Alignment

| Constitution | UI Manifestation |
| --- | --- |
| Listening Session | Active Player State |
| Domain Isolation | Persistent Tabbed Navigation |
| Playback Policy | Automatic Engine Behavior |
| Capability Contracts | Hidden Implementation Details |

## 3. Primary Interface Model

The UI SHALL strictly partition the screen into three persistent contexts, ensuring no cross-contamination of queues. Only one playback context SHALL be visible as active at any time.

| Tab | Format | Policy Context | Primary Control Logic |
| --- | --- | --- | --- |
| Music | Stateless | `MusicPolicy` | Shuffle, Repeat, Gapless |
| Podcast | Stateful | `PodcastPolicy` | ±30s Skip, Transcript sync |
| Audiobook | Stateful | `AudiobookPolicy` | Chapter Memory, Sleep Timer |

## 4. "Invisible Magic" Mechanics (Zero-Configuration)

- Automatic Playback Matching: during ingestion, classify media into the appropriate domain and mount the corresponding `Playback Policy`.
- Smart Speed Memory: the active Listening Session SHALL persist playback speed independently per media domain.
- Universal Search: a single search bar queries the `Index`; results SHALL be grouped by media domain and SHALL NOT merge domain-specific metadata.
- Media Ingestion: classify media using available metadata, content heuristics, or provider-specific classification regardless of ingestion mechanism.

## 5. Responsive Player Modes

- Mini Player: persistent playback surface for the currently mounted Listening Session.
- Now Playing (Expanded): full artwork, queue management, lyrics/transcript, device output selection.
- Immersive Player: full-screen, high-fidelity background blur, waveform visualizers, interactive transcripts.
- These modes are presentation-layer states only and SHALL NOT alter Listening Session semantics.

## 6. Ambient Layering (Shell Mixer)

Concurrent background audio (Rain, White Noise) is NOT a Listening Session. It is a `Shell` audio-mixer capability, surfaced as a single "Water Slider" overlay on Podcast/Audiobook player screens. The Shell handles ducking when the narrator is active.

## 7. Progressive Disclosure

- Quick Controls: Play/Pause, Queue, Speed.
- Player Detail: EQ, ReplayGain, Silence Skip.
- Music Station Settings: Provider management, Downloads, Sync, Appearance.

## 8. Platform Integration

One-Tap Sync: authentication to remote media providers uses platform-agnostic mechanisms, hiding server path implementations from the user.

## 9. UI State Invariants

- Active Context: at most one active playback context.
- State Independence: changing presentation modes SHALL NOT alter playback state.
- Domain Navigation: navigating between domains mounts the corresponding Listening Session.
- Presentation/Policy Decoupling: presentation state independent of Playback Policy.
- Queue Ownership: queue visualizations exclusively represent the active session's queue.
- Theme Independence: appearance SHALL NOT alter playback behavior.
- Device Independence: functionally equivalent across device classes.
- AI Independence: AI outputs are optional augmentations, never required for core playback.

## 10. Accessibility & Resilience

The interface SHALL remain fully operable without artwork, animations, waveform rendering, or network-derived metadata.
