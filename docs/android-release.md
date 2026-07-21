# Android signed release (GitHub Actions + sideload)

Lane A P0 distribution: tagged releases ship **signed per-ABI release APKs** on GitHub Releases. F-Droid builds from the same source tag and signs with the F-Droid archive key (see [fdroid-submit.md](./fdroid-submit.md)).

## One-time keystore setup

Generate a release keystore locally (store backup offline):

```bash
keytool -genkeypair -v -keystore release.keystore -alias sovereign-release \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass YOUR_STORE_PASSWORD -keypass YOUR_KEY_PASSWORD \
  -dname "CN=Your Name, OU=Dev, O=Sandbox Music, L=City, ST=State, C=US"
```

Local sideload test:

```bash
cp android/keystore.properties.example android/keystore.properties
# edit passwords + alias; move release.keystore into android/
npm run build:android:release
# → android/app/build/outputs/apk/release/app-arm64-v8a-release.apk (etc.)
```

## GitHub Actions secrets

Repository → **Settings → Secrets and variables → Actions** → New repository secret:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of `release.keystore` (see below) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore store password |
| `ANDROID_KEY_ALIAS` | e.g. `sovereign-release` |
| `ANDROID_KEY_PASSWORD` | Key password |

Encode keystore (Linux/macOS):

```bash
base64 -w0 android/release.keystore
```

PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("android\release.keystore"))
```

## Release pipeline (`release.yml`)

On tag push `v*`:

1. **Lint, tests, typecheck**
2. **Android smoke E2E** (emulator)
3. **F-Droid build verify** — `npm run fdroid:local` (unsigned release APK, same recipe as fdroiddata)
4. **Signed release** — decode secrets → `assembleRelease` → per-ABI APKs in `release-android/`
5. **GitHub Release** — attaches `sandbox-music-{version}-{abi}.apk` + `SHA256SUMS`

If signing secrets are missing, the signed release job fails with a pointer to this doc.

## F-Droid vs GitHub APK

| Channel | Signing | Build command |
| --- | --- | --- |
| **F-Droid** | F-Droid archive key | `fdroid build` from tagged source ([metadata/fdroid/metadata.yml](../metadata/fdroid/metadata.yml)) |
| **GitHub Releases** | Your upload keystore (secrets above) | CI `assembleRelease` after `scripts/android-ci-keystore.mjs` |
| **CI / dev** | Debug key | `assembleDebug` |

F-Droid does **not** use your GitHub keystore. Keep `versionCode` / `versionName` in `android/app/build.gradle` in sync with `metadata/fdroid/metadata.yml` before each tag.

## Version bump checklist

1. Bump `versionCode` + `versionName` in `android/app/build.gradle`
2. Sync `metadata/fdroid/metadata.yml` (`Builds`, `CurrentVersion*`, commit tag)
3. Tag: `git tag v1.0.1 && git push origin v1.0.1`
4. Confirm GitHub Release contains signed APKs for target ABIs (typically **arm64-v8a** for modern phones)

## Per-ABI APKs

Universal APK is disabled (~200 MB with bundled Python/ffmpeg). Install the ABI matching the device:

- **arm64-v8a** — most phones (2018+)
- **armeabi-v7a** — older 32-bit ARM
- **x86_64** — emulators / some tablets
