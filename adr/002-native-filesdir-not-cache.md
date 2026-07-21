# ADR 002: Android locker audio lives in filesDir, not cacheDir

## Status

Accepted

## Context

Android ExoPlayer cannot reliably play WebView `blob:` URLs. Locker audio for native playback is mirrored into durable files exposed as `content://` URIs. Historically, storing locker blobs under `getCacheDir()` led to OS eviction under storage pressure, wiping offline libraries (v0.53-era durability work noted in Pass 2 library audit).

Pass 2 verified `LockerBlobRegistry` uses `context.getFilesDir()/locker_blobs` with explicit comments forbidding cache storage, plus migration from legacy cache paths.

## Decision

Android locker audio blobs **must** be stored under `filesDir/locker_blobs`, not `getCacheDir()`.

- `LockerBlobRegistry.lockerDir` resolves to `getFilesDir()`.
- `warmFromDisk` and `migrateCacheBlobsToFilesDir` attempt legacy cache migration on boot.
- JS bridge (`nativeExoLockerBridge`) writes chunks via `beginLockerBlob` / `appendLockerBlobChunk` / `finishLockerBlob` into this durable store.
- Playback gate (`ensureLockerPlayable`) rejects Android `blob:` URLs and requires `content://` resolution.

## Consequences

### Positive

- Locker audio survives normal Android cache eviction policies.
- Exo gapless queue can use stable `content://` URIs for offline playback.
- Aligns with "metadata is sacred, bytes are healable" library durability model.

### Negative

- Legacy installs may retain survivors in cache after failed migration (`verifyLockerIntegrityOnBoot` warns when `cacheBlobCount > 0`).
- Multi-store drift risk between IndexedDB blobs, native files, and `nativeSourcePath` flags.
- Chunked bridge write is slow for large files; app kill before import can leave hollow rows.

## Evidence

- `docs/audit/library-analysis.md` — Verified Facts §5 (filesDir), §9 (Android `content://` playback)
- `docs/audit/library-invariants.md` — Android `filesDir` invariant; `content://` vs `blob:` invariant
- `docs/audit/audio-analysis.md` — Verified Facts §4 (LockerBlobRegistry durable storage)
- `docs/audit/audio-invariants.md` — `blob:` must not reach Exo; filesDir not cacheDir
