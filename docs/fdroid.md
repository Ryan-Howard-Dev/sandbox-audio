# F-Droid reproducible build

Application ID: `rd.sheepskin.sandboxmusic`

This doc complements [metadata/fdroid/README.md](../metadata/fdroid/README.md) with reproducible-build steps and anti-feature rationale.

## Quick local verify

From repo root (mirrors F-Droid `prebuild` + Gradle release):

```bash
npm run fdroid:local
# → android/app/build/outputs/apk/release/app-release-unsigned.apk
```

Debug sideload (no F-Droid recipe):

```bash
npm run build:android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk
```

## Tagged release workflow

1. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
2. Sync [metadata/fdroid/metadata.yml](../metadata/fdroid/metadata.yml) (`CurrentVersion*`, `Builds` commit tag).
3. Tag on GitHub: `git tag v1.0.0 && git push origin v1.0.0`
4. Run local verify at tag: `git checkout v1.0.0 && npm run fdroid:local`

## Full F-Droid server build (Linux)

Requires [fdroidserver](https://f-droid.org/docs/Build_Metadata_Reference/) and a fork of [fdroiddata](https://gitlab.com/fdroid/fdroiddata):

```bash
git clone https://gitlab.com/fdroid/fdroiddata.git
cd fdroiddata

# Copy from this repo:
#   metadata/fdroid/metadata.yml → metadata/rd.sheepskin.sandboxmusic.yml
#   metadata/fdroid/en-US/**     → metadata/rd.sheepskin.sandboxmusic/en-US/

fdroid lint rd.sheepskin.sandboxmusic
fdroid readmeta rd.sheepskin.sandboxmusic
fdroid build rd.sheepskin.sandboxmusic:1 --verbose
```

F-Droid signs with the **F-Droid archive key** — your Play upload keystore is not required for standard submission.

### Reproducibility checklist

- [ ] Clean git checkout at release tag
- [ ] `npm ci` + `npm run build:client` + `npx cap sync android` (see `Builds.prebuild` in `metadata.yml`)
- [ ] No committed secrets (`google-services.json`, keystore passwords)
- [ ] `versionCode` monotonic vs prior F-Droid build
- [ ] Compare APK hash with F-Droid build artifact after MR merge

## Anti-features (declared in metadata)

| Flag | Why |
| --- | --- |
| **Network** | Catalog metadata, Cast, optional tier34 backend |
| **NonFreeNet** | YouTube/yt-dlp (tier34), TheAudioDB, iTunes Search API |
| **NonFreeDep** | Google Cast SDK (`play-services-cast-framework`) |
| **TetheredNet** | Self-hosted Tier 3/4 for Feed, acquire, Connect, Meilisearch, DLNA |

Localized explanations: `metadata/fdroid/en-US/antiFeatures/*.txt`

Core locker import/playback and local playlists work without tier34. **Air-Gap Mode** blocks outbound client requests; tier34 backend traffic is separate.

## Blockers before acceptance

1. Maintainer merge request to fdroiddata with metadata + anti-feature texts
2. Successful `fdroid build` on F-Droid infra from tagged source
3. Reviewer sign-off on Cast / Play services (`NonFreeDep`)
4. Optional: [App Signing by Maintainer](https://f-droid.org/docs/Reproducible_Builds/#app-signing-by-maintainer) if you want your own signing key on F-Droid

## Files in this repo

| Path | Purpose |
| --- | --- |
| `metadata/fdroid/metadata.yml` | fdroiddata template (build recipe, anti-features) |
| `metadata/fdroid/build.gradle.snippet` | Version/applicationId reference |
| `scripts/fdroid-prebuild.mjs` | Local prebuild mirror |
| `scripts/fdroid-assemble-release.mjs` | Unsigned release APK |
| `metadata/fdroid/en-US/` | Summary, description, anti-feature copy |

See also [README.md](../README.md#android--f-droid).
