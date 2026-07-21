# F-Droid submission guide (maintainers)

Application ID: `rd.sheepskin.sandboxmusic`

## Prerequisites

- Public git repo: https://github.com/SheepSkinRD/sandbox-music
- Tagged releases matching `UpdateCheckMode` in metadata (e.g. `v1.0.0`)
- MIT `LICENSE` at repo root
- No committed secrets (`google-services.json`, keystore passwords)

## Local verify (before MR)

Mirrors F-Droid `Builds.prebuild` + release assemble:

```bash
npm run fdroid:local
# → android/app/build/outputs/apk/release/app-release-unsigned.apk
```

Debug sideload (Windows / device smoke test):

```bash
npm run build:android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## CI verification

Every push/PR runs `npm run fdroid:local` in `.github/workflows/ci.yml` (`android-release` job). Tagged releases also run F-Droid verify + signed APK build — see [docs/android-release.md](./android-release.md).

## fdroiddata merge request

1. Fork https://gitlab.com/fdroid/fdroiddata
2. Copy from this repo:
   - `metadata/fdroid/metadata.yml` → `metadata/rd.sheepskin.sandboxmusic.yml`
   - `metadata/fdroid/en-US/**` → `metadata/rd.sheepskin.sandboxmusic/en-US/`
3. Bump `versionCode` / `versionName` in `android/app/build.gradle` and sync `metadata.yml` (`Builds`, `CurrentVersion*`, commit tag)
4. On Linux with fdroidserver:

```bash
fdroid lint rd.sheepskin.sandboxmusic
fdroid readmeta rd.sheepskin.sandboxmusic
fdroid build rd.sheepskin.sandboxmusic:1 --verbose
```

5. Open MR; respond to reviewer questions on Cast / Play services

## Anti-features justification

| Flag | User-visible reason |
| --- | --- |
| **Network** | Catalog metadata, optional tier34 backend, Cast |
| **NonFreeNet** | YouTube/yt-dlp on tier34, iTunes/MusicBrainz/TheAudioDB |
| **NonFreeDep** | Google Cast SDK (`play-services-cast-framework`) |
| **TetheredNet** | Self-hosted tier34 for Feed, acquire, Connect, Meilisearch, DLNA |

Localized copy: `metadata/fdroid/en-US/antiFeatures/*.txt`

Core locker playback works offline without tier34. Air-Gap Mode blocks outbound client traffic.

## Signing model

- **F-Droid default:** archive signing key (no upload keystore required)
- **Play Store:** separate upload keystore (`android/keystore.properties`) — not used by F-Droid build
- Optional [App Signing by Maintainer](https://f-droid.org/docs/Reproducible_Builds/#app-signing-by-maintainer)

## Version sync checklist

- [ ] `android/app/build.gradle` — `versionCode`, `versionName`
- [ ] `metadata/fdroid/metadata.yml` — `Builds[].commit`, `CurrentVersion`, `CurrentVersionCode`
- [ ] Git tag pushed (`v*`)
- [ ] `npm run fdroid:local` succeeds at tag
- [ ] Anti-feature texts copied into fdroiddata

See also [docs/fdroid.md](./fdroid.md) and [metadata/fdroid/README.md](../metadata/fdroid/README.md).
