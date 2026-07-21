# F-Droid submission template

Application ID: `rd.sheepskin.sandboxmusic`

Source: `https://github.com/SheepSkinRD/sandbox-music`

## Signing model (F-Droid vs Play Store)

| | F-Droid | Play Store |
|---|---------|------------|
| Build source | F-Droid server clones your git tag and runs the recipe | You upload AAB/APK |
| Signing key | **F-Droid archive key** (default) | **Your upload keystore** (required) |
| Your keystore | Not needed for standard submission | Required (`keystore.properties`) |
| Reproducible builds | Required; reviewers verify byte-identical output | Not required |

Optional `android/keystore.properties` in this repo is for **local release APK testing** (`npm run build:android:release`) or [App Signing by Maintainer](https://f-droid.org/docs/Reproducible_Builds/#app-signing-by-maintainer). F-Droid does not use your Play Store upload key.

## Local commands (this repo)

```bash
# Debug sideload (no keystore)
npm run build:android:apk
# → android/app/build/outputs/apk/debug/app-debug.apk

# Mirror F-Droid prebuild + unsigned release APK (no keystore required)
npm run fdroid:local
# → android/app/build/outputs/apk/release/app-release-unsigned.apk
```

`fdroid:prebuild` runs the same steps as the `Builds.prebuild` block in `metadata.yml`.

## F-Droid server toolchain (Linux)

Requires [fdroidserver](https://f-droid.org/docs/Build_Metadata_Reference/) and a fork of [fdroiddata](https://gitlab.com/fdroid/fdroiddata):

```bash
git clone https://gitlab.com/fdroid/fdroiddata.git
cd fdroiddata
# Copy metadata/rd.sheepskin.sandboxmusic.yml from metadata/fdroid/metadata.yml
# Copy metadata/fdroid/en-US/** into fdroiddata metadata locale tree

fdroid lint rd.sheepskin.sandboxmusic
fdroid readmeta rd.sheepskin.sandboxmusic
fdroid build rd.sheepskin.sandboxmusic:1 --verbose
fdroid publish   # maintainers only, after MR merge
```

## Before submitting

1. Tag releases on GitHub matching `UpdateCheckMode` (e.g. `v1.0.0` for versionName `1.0.0`).
2. Bump `versionCode` / `versionName` in `android/app/build.gradle`; sync `metadata.yml` and `build.gradle.snippet`.
3. Confirm MIT `LICENSE` at repo root.
4. Run `npm run fdroid:local` or full `fdroid build` from fdroiddata; fix reproducibility issues.
5. No `google-services.json` / Firebase in repo (Cast uses Play services Cast SDK only — declare `NonFreeDep`).

## Files

| File | Purpose |
|------|---------|
| [docs/android-release.md](../../docs/android-release.md) | Signed GitHub Release APKs + CI secrets |
| `metadata.yml` | fdroiddata app metadata (builds, anti-features, source URL) |
| `build.gradle.snippet` | Reference version/applicationId for reviewers |
| `en-US/summary.txt`, `en-US/description.txt` | Store listing text |
| `en-US/antiFeatures/*.txt` | Network, NonFreeNet, NonFreeDep, TetheredNet explanations |

## Anti-features

- **Network** — catalog metadata, Cast, optional tier34 backend
- **NonFreeNet** — YouTube/yt-dlp (tier34), TheAudioDB, iTunes Search API
- **NonFreeDep** — Google Cast SDK (`play-services-cast-framework`)
- **TetheredNet** — self-hosted Tier 3/4 backend for Feed, acquire, Connect, etc.

## Checklist

- [ ] Public git repo with tagged releases
- [ ] `fdroid build` succeeds from clean checkout at tag
- [ ] `versionCode` monotonic; metadata matches `android/app/build.gradle`
- [ ] Copy `en-US/antiFeatures/*.txt` (including `NonFreeDep.txt`) into fdroiddata
- [ ] Open fdroiddata merge request; respond to reviewer feedback on Cast/Play services

See: https://f-droid.org/docs/Submitting_to_F-Droid_Quick_Start_Guide/

Reproducible build details: [docs/fdroid.md](../../docs/fdroid.md)
