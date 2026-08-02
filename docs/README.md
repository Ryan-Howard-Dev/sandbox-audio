# Documentation

Thirty-six documents, grouped by what you are trying to do. Start with
[Sandbox Architecture](sandbox-architecture.md) if you are new to the codebase.

The names below are the documents' own titles, not summaries written separately, so this index
cannot describe something the document does not say.

## Start here

| Document | What it covers |
| --- | --- |
| [Sandbox Architecture](sandbox-architecture.md) | How the pieces fit: stations, the playback engine, the optional server. |
| [Executive Summary](executive-summary.md) | The project in a page. |
| [Built-in Music](BUILT-IN-MUSIC.md) | The audio and listening-session rules the player is built to. |
| [Chronicle](CHRONICLE.md) | The design log. Why things are the way they are, in order. |

## Building and releasing

| Document | What it covers |
| --- | --- |
| [Android signed release](android-release.md) | GitHub Actions and sideload. |
| [F-Droid reproducible build](fdroid.md) | Building the way F-Droid does. |
| [F-Droid submission guide](fdroid-submit.md) | What maintainers need from us. |
| [Desktop setup](desktop-setup.md) | Installer versus first launch. |
| [Multi-platform testing checklist](testing-checklist.md) | What to exercise before shipping. |

## Playback and devices

| Document | What it covers |
| --- | --- |
| [Android background playback](android-playback.md) | Keeping audio alive with the screen off. |
| [Android Auto](android-auto.md) | Browse and play in a car. |
| [Android TV readiness](android-tv-readiness.md) | What works on a ten-foot screen. |
| [Sandbox Cast](android-remote-cast.md) | Casting from the phone. |
| [DLNA / UPnP MediaServer](dlna-mediaserver.md) | Serving the locker to other devices. |
| [Android wake alarm](android-wake-alarm.md) | Waking the device to play. |
| [Vinyl now-playing widget](vinyl-widget-embed.md) | Embedding the turntable in OBS or a dashboard. |

## The server

| Document | What it covers |
| --- | --- |
| [Sandbox Infrastructure](INFRASTRUCTURE.md) | What the household server is and is not. |
| [OpenSubsonic API](opensubsonic.md) | The Subsonic-compatible surface. |
| [Sandbox Indexer](sandbox-indexer.md) | How the library gets catalogued. |
| [Tier34 validation suite](tier34-validation.md) | Proving a server install works. |
| [Overlay network](overlay-network.md) | Self-hosted remote access. |
| [HTTP/3 (QUIC) gateway](http3-quic.md) | Transport for the server. |
| [Linux TCP BBR](linux-tcp-bbr.md) | Congestion control for server hosts. |
| [Linux network bonding](linux-network-bonding.md) | LAN plus cellular tether. |

## Library and listening

| Document | What it covers |
| --- | --- |
| [Beets integration](beets-integration.md) | Folder watch into the locker. |
| [Scrobbling](scrobbling.md) | Listening history, and where it goes. |
| [Federated taste profiles](federated-taste.md) | Sharing taste without a central service. |
| [Offline capability audit](offline-capability.md) | What still works with the network off. |
| [Air-gap LAN party](air-gap-lan-party.md) | Running with no internet at all. |

## Design and review

| Document | What it covers |
| --- | --- |
| [Music UI: the Holy Trinity](MUSIC-UI-HOLY-TRINITY.md) | The interface specification. |
| [Music station gap analysis](MUSIC-STATION-GAP-ANALYSIS.md) | Constitution against reality. |
| [Consolidated reviews](CONSOLIDATED-REVIEWS.md) | Review findings, gathered. |
| [Repository health](repository-health.md) | The state of the codebase. |
| [Risk register](risk-register.md) | What could go wrong, and what is being done. |
| [Interminable Tide](interminable-tide.md) | — |

## Store listing

Not in this directory, but worth knowing where it lives.

The Play and F-Droid listing text is in `fastlane/metadata/android/en-US/`. Screenshots go in
`images/` beside it; see [that directory's README](../fastlane/metadata/android/en-US/images/README.md)
for the sizes both stores expect. The F-Droid build recipe is `metadata/fdroid/metadata.yml`.

## Adding to this index

Give the document a `#` heading on its first line and add a row here. The heading is what this
index quotes, so a document whose heading does not describe it will read badly in both places,
which is the point.
