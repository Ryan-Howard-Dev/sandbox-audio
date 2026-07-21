# Pass 2 — Media Library & Local Storage Analysis

Subsystem: **Media Library & Local Storage** (canonical paths: `src/lockerStorage.ts`, `src/LockerVaultContext.tsx`, `src/stations/LocalView.tsx`, `src/lockerDurability.ts`, `src/lockerSync.ts`, `src/albumArtCache.ts`, `src/nativeExoLockerBridge.ts`, `android/.../LockerBlobRegistry.java`, `tier34-server/lib/lockerStorage.ts`). **Code-only audit — 2026-07-21.**

**Out of scope (other Pass 2 subsystems):** playback queue persistence (`queuePersistence.ts`), audio FSM/decode (`sandboxLayer1`), provider/search tier resolution (`playbackPipeline.ts`, `unifiedSearch.ts`).

---

## Subsystem Interface

### Inputs

| Input | Source | Handler / module |
|-------|--------|------------------|
| User file upload (album / track) | `LocalView` upload UI, drag-drop | `saveLockerFile`, `saveLockerFilesAsAlbum` (`lockerStorage.ts`) |
| Catalog download / acquire completion | `acquisitionPipeline`, `mobileAcquisition`, tier34 workers | `saveLockerBlob`, `saveLockerBlobFromNativeFile` |
| Device music scan hits | `DeviceMusicScanPanel` | `saveLockerBlobFromNativeFile` |
| User metadata edit | `EditLockerInfoModal` in `LocalView` | `updateLockerEntryMetadata`, `updateAlbumGroupMetadata` |
| User delete (track / album) | `LocalView`, `sandboxLayer3` | `removeLockerEntry`, `removeAlbumFromLocker` (+ `LOCKER_USER_DELETE_CONFIRMED`) |
| Repair Locker destructive actions | `LockerRepairPanel` in Settings | `reconcileLockerBlobIntegrity({ clearHollowRows, deleteEmptyBlobs, userConfirmed: LOCKER_REPAIR_USER_CONFIRMED })` |
| Remote sync manifest + blobs | tier34 / WebDAV when `lockerSync` enabled | `pullMissingLockerBlobsFromRemote`, `saveLockerBlob` |
| Boot / vault warm | `LockerVaultProvider` mount | `warmLockerCache`, deferred `runDeferredVaultBoot` |
| Playback locker gate | `ensureLockerPlayable` (playback pass) | `resolveLockerEnvelopeForPlayback`, `reconcileLockerBlobIntegrity`, `warmLockerNativePlaybackCache` |
| Capacity limit | Settings → Device Capacity | `capacityLimitBytes`, `LockerCapacityExceededError` on upload |

### Outputs

| Output | Consumer |
|--------|----------|
| `LockerEntry[]` in-memory cache + React context | `LocalView`, artist hubs, search, playlists, queue rehydrate |
| `offlineReady` / `url` on each entry | Browse filters, `filterPlayableLockerEntries`, playback envelope build |
| Android `content://` locker URIs | `NativeExoPlaybackPlugin`, Exo gapless queue (playback pass) |
| `LockerSyncManifest` push/pull | tier34-server `lockerStorage.ts`, WebDAV, cross-device sync |
| Android SQLite mirror rows | `lockerMirror` native search (`LockerMirrorDatabase.java`) |
| Integrity manifest (`locker-integrity-manifest-v1`) | Boot heal, Settings durability report |
| Track tombstones (export only) | Manifest push via `recordTrackTombstone`; **not** applied on pull |
| Session album-art cache | `albumArtCache.ts` → `LocalView` banners / thumbs |
| Download precheck skip lists | `downloadLockerPrecheck` → acquisition pipeline |

### State changes

- **IndexedDB** (`SandboxMusicCoreDB` v3): `tracks` metadata store + `track_blobs` audio/art blobs; `hasAudioBlob`, `offlineReady`, `nativeSourcePath`, `userMetadataLocked` flags on rows.
- **In-memory `lockerCache`**: warmed at boot; `subscribeLockerCache` notifies UI; `getLockerEntriesSnapshot()` for synchronous reads.
- **Android native**: `filesDir/locker_blobs` durable files (`LockerBlobRegistry`); in-memory `FILES` index; migration from legacy `cacheDir/locker_blobs`.
- **Hollow state**: `markLockerEntryHollow` clears `hasAudioBlob`, `offlineReady`, stale `blob:` URLs — metadata row retained.
- **Sync prefs**: `sandbox_locker_sync_settings`, album flags via `prefsStorage` (localStorage or sessionStorage per Data Persistence).
- **View prefs**: `sandbox_locker_view_prefs_v1` (sort, layout, browse filter).
- **Session-only**: `albumArtCache` `knownGoodByAlbumKey` Map; ephemeral `blob:` object URLs.

### External dependencies

| Dependency | Role in subsystem |
|------------|-------------------|
| IndexedDB (`SandboxMusicCoreDB`) | Primary metadata + blob persistence (web, Capacitor WebView) |
| `localStorage` | Integrity manifest (`locker-integrity-manifest-v1`), sync device id |
| `prefsStorage` | Sync settings, view prefs, tombstones (routed per security Data Persistence) |
| Capacitor `NativeExoPlayback` plugin | `beginLockerBlob` / chunk write / `auditLockerStorage` |
| `LockerBlobRegistry` + `LockerBlobContentProvider` | Durable Android file store + `content://` URIs |
| `LockerMirror` Capacitor plugin | Android SQLite metadata mirror for search |
| tier34-server `lib/lockerStorage.ts` | Remote manifest + hash-addressed blob files |
| `bootInteractivity` gate | Defers heavy heal / full playability probes |
| `downloadQueue` / `acquisitionPipeline` | Reacquire hollow tracks, resume after sync |
| `embeddedCover`, `albumCover`, ID3 parsers | Upload metadata enrichment |

### Called by

- `main.tsx` → `LockerVaultProvider` wraps app shell
- `LocalView.tsx`, `LockerArtistHub`, `LockerSearchView`, `SonicLockerStationView`
- `sandboxLayer3.tsx` (delete handler, play path via `ensureLockerPlayable`)
- `mobileAcquisition.ts`, `downloadLockerPrecheck.ts`, `prepareForTravel.ts`
- `playlistStorage` / stub rematch (`repairAllPlaylistsFromLocker`)
- Settings (`LockerRepairPanel`, sync panels)
- E2E / stress scripts (locker diagnostics)

### Calls into

- `lockerDurability` (integrity manifest, boot verify, native audit)
- `lockerDeleteGuard` (user-confirmed deletes, `blockLockerAutoDelete`)
- `lockerSync` (background pull, manifest push, conflict queue)
- `lockerDeadTrackReacquire` (hollow → download job)
- `nativeExoLockerBridge` (IDB blob → native `content://`)
- `lockerMirror.syncLockerMirror`
- `albumArtCache` (cover consensus / session cache)
- `lockerAlbumBackfill`, `libraryMetadataAutoRepair`, `metadataRepair`
- tier34 HTTP client (sync blob pull)

### Persistence

| Layer | Location | Survives restart |
|-------|----------|------------------|
| Track metadata | IDB `tracks` | Yes |
| Audio / cover blobs | IDB `track_blobs` | Yes |
| Native locker audio | `context.getFilesDir()/locker_blobs/` | Yes |
| Legacy cache audio | `getCacheDir()/locker_blobs/` | **No** (OS may evict; migration attempted) |
| Integrity manifest | `localStorage` `locker-integrity-manifest-v1` | Yes (unless quota) |
| Sync settings / tombstones | `prefsStorage` keys | Yes (if Data Persistence on) |
| Album art session cache | `albumArtCache` in-memory Map | **No** |
| Android search mirror | SQLite via `LockerMirror` plugin | Yes (rebuilt from IDB) |
| Remote blobs | tier34 `LOCKER_BLOBS_DIR` (hash files) | Server-side |

### Threading / async behaviour

- Vault load: single `lockerLoadPromise` dedupes concurrent `getLockerEntries()`; boot uses `playabilityMode: 'fast'` until `isBootUiInteractive()`.
- Deferred boot (`runDeferredVaultBoot`): chunked via `yieldToMain` after boot gate; orphan recovery, native path repair, integrity verify, remote pull run sequentially off critical path.
- `warmLockerNativePlaybackCache`: per-entry async loop with `yieldToMain` — on-demand at playback (`ensureLockerPlayable`), skipped at boot (`skipNativeWarm: true`).
- Native blob write: chunked base64 bridge (`CHUNK_BYTES = 512KB`) with `yieldToMain` between chunks.
- `subscribeLockerCache`: synchronous listener fan-out on cache mutations.
- Sync pull: sequential blob downloads in `pullMissingLockerBlobsFromRemote`; Wi-Fi gate via `isNetworkAllowedForSync`.
- IDB transactions: per-operation `readwrite` transactions; no shared worker thread.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/LockerVaultContext.tsx
    - src/lockerDurability.ts
    - src/lockerSync.ts
    - src/bootInteractivity.ts
    - src/play/ensureLockerPlayable.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
  symbols:
    - warmLockerCache
    - runDeferredVaultBoot
    - reconcileLockerBlobIntegrity
    - verifyLockerIntegrityOnBoot
    - saveLockerBlob
  confidence: High
  evidence_type:
    - implementation
```

---

## Verified Facts (Only statements directly supported by code)

1. **IndexedDB schema is version 3 with split stores.** `SandboxMusicCoreDB` uses `tracks` (metadata) and `track_blobs` (audio/art); upgrade migrates inline blobs to dedicated store.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
  symbols:
    - initDB
    - DB_VERSION
    - migrateTrackBlobsToDedicatedStore
  confidence: High
  evidence_type:
    - implementation
```

2. **Auto-delete of locker rows is blocked in production.** `LOCKER_NEVER_AUTO_DELETE`, `blockLockerAutoDelete`, and `applyTrackTombstonesFromManifest` (returns 0, logs skip) enforce no silent mass deletion.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/lockerDeleteGuard.ts
    - src/lockerSync.ts
  symbols:
    - LOCKER_NEVER_AUTO_DELETE
    - blockLockerAutoDelete
    - applyTrackTombstonesFromManifest
  confidence: High
  evidence_type:
    - implementation
```

3. **User-initiated deletes require `LOCKER_USER_DELETE_CONFIRMED` symbol.** `removeLockerEntry`, `removeAlbumFromLocker`, `clearLockerVault` call `assertLockerUserDeleteConfirmed`.

```yaml
evidence:
  files:
    - src/lockerDeleteGuard.ts
    - src/lockerStorage.ts
    - src/stations/LocalView.tsx
  symbols:
    - assertLockerUserDeleteConfirmed
    - removeLockerEntry
  confidence: High
  evidence_type:
    - implementation
```

4. **Hollow rows retain metadata when audio bytes are missing.** `markLockerEntryHollow` sets `hasAudioBlob=false`, `offlineReady=false`, strips stale `blob:` URL; row is not deleted. `verifyLockerIntegrityOnBoot` marks hollow and queues reacquire.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/lockerDurability.ts
    - src/lockerDeadTrackReacquire.ts
  symbols:
    - markLockerEntryHollow
    - verifyLockerIntegrityOnBoot
    - queueDeadLockerTrackReacquire
  confidence: High
  evidence_type:
    - implementation
```

5. **Android durable storage uses `filesDir/locker_blobs`, not cache.** `LockerBlobRegistry.lockerDir` explicitly avoids `getCacheDir()`; `warmFromDisk` migrates legacy cache blobs.

```yaml
evidence:
  files:
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
  symbols:
    - lockerDir
    - migrateCacheBlobsToFilesDir
    - warmFromDisk
  confidence: High
  evidence_type:
    - implementation
```

6. **Boot fast-load may stamp `offlineReady` without full native/IDB probes.** `getLockerEntries` uses `playabilityMode: 'fast'` when `!isBootUiInteractive()`; `refreshLockerPlayabilityFull` runs after boot gate.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/LockerVaultContext.tsx
    - src/bootInteractivity.ts
  symbols:
    - enrichLockerEntriesPlayability
    - lockerEntryFastPlayable
    - refreshLockerPlayabilityFull
  confidence: High
  evidence_type:
    - implementation
```

7. **Browse lists filter to playable rows; hollow rows can still exist in full cache.** `filterPlayableLockerEntries` requires `offlineReady === true`; `dedupeLockerEntriesForDisplay` shows hollow when no playable duplicate exists.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
  symbols:
    - filterPlayableLockerEntries
    - dedupeLockerEntriesForDisplay
  confidence: High
  evidence_type:
    - implementation
```

8. **Remote track tombstones are recorded locally on delete but never applied on pull.** `recordTrackTombstone` on `removeLockerEntry`; `applyTrackTombstonesFromManifest` is a no-op.

```yaml
evidence:
  files:
    - src/lockerTrackTombstones.ts
    - src/lockerSync.ts
    - src/lockerStorage.ts
  symbols:
    - recordTrackTombstone
    - applyTrackTombstonesFromManifest
  confidence: High
  evidence_type:
    - implementation
```

9. **Android playback resolves via native `content://`, not WebView `blob:`.** `resolveLockerEnvelopeForPlayback` on Android calls `healLockerEntryNativePlayback`; `ensureLockerPlayable` returns `missing-audio` for `blob:` on Android.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/play/ensureLockerPlayable.ts
  symbols:
    - resolveLockerEnvelopeForPlayback
    - healLockerEntryNativePlayback
    - ensureLockerPlayable
  confidence: High
  evidence_type:
    - implementation
```

10. **tier34-server stores locker blobs as hash-addressed files with JSON manifest.** Separate from client IDB; used when sync provider is `tier34`.

```yaml
evidence:
  files:
    - tier34-server/lib/lockerStorage.ts
    - tier34-server/lib/lockerPaths.ts
  symbols:
    - MANIFEST_PATH
    - LOCKER_BLOBS_DIR
  confidence: High
  evidence_type:
    - storage
```

11. **Album art session cache is in-memory only.** `albumArtCache.ts` documents session-scoped `knownGoodByAlbumKey` Map; not persisted across reload.

```yaml
evidence:
  files:
    - src/albumArtCache.ts
  symbols:
    - rememberKnownGoodAlbumArt
    - resolveLockerAlbumArtSrc
  confidence: High
  evidence_type:
    - implementation
```

12. **Destructive hollow pruning requires `LOCKER_REPAIR_USER_CONFIRMED`.** `reconcileLockerBlobIntegrity` with `clearHollowRows` calls `assertLockerRepairDestructiveAllowed`.

```yaml
evidence:
  files:
    - src/lockerDeleteGuard.ts
    - src/lockerStorage.ts
  symbols:
    - assertLockerRepairDestructiveAllowed
    - reconcileLockerBlobIntegrity
  confidence: High
  evidence_type:
    - implementation
```

---

## Architectural Interpretation

**Confidence: Medium** (inferred layering from module boundaries and call graph; individual facts above are High.)

The subsystem implements a **three-tier local library**:

1. **Canonical store** — IndexedDB metadata + `track_blobs`, with `lockerCache` as the hot read model and `LockerVaultContext` as the React subscription boundary.
2. **Platform playback cache** — On Android, IDB bytes are mirrored into `filesDir/locker_blobs` and exposed as `content://` URIs because ExoPlayer cannot consume revoked WebView blob URLs reliably.
3. **Optional remote replica** — tier34/WebDAV manifest + content-hash blobs for cross-device sync; client pull is additive (missing ids only), never destructive.

Durability policy is **"metadata is sacred, bytes are healable"**: missing audio becomes hollow state, boot integrity compares manifest vs bytes, and reacquire pipelines refill without duplicating rows when possible (`findLockerEntryForTrackIncludingHollow`, `replaceEntryId` in `saveLockerBlob`).

UI (`LocalView`) sits above the vault context and performs presentation-only grouping (`collectionIntelligence`, album hubs, browse filters) while delegating all mutations to `lockerStorage`. Search has a dual path: in-memory/library filters plus Android native mirror for scale.

The v0.53-era durability work (evident in `LockerBlobRegistry` comments and `lockerDurability.auditNativeLockerStorage`) addresses historical **cache-dir eviction** that wiped offline libraries; migration is best-effort and survivors are logged for retry.

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/lockerDurability.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
    - src/LockerVaultContext.tsx
    - src/stations/LocalView.tsx
  confidence: Medium
  evidence_type:
    - implementation
```

---

## Engineering Assessment

### Strengths

- Explicit delete guards and production throws on auto-prune paths reduce accidental data loss during heal/sync development.
- Split IDB stores keep metadata reads lighter; boot sequencing defers heavy work behind `bootInteractivity`.
- Hollow-row model preserves user metadata and enables in-place reacquire instead of orphan duplicates.
- Native migration from `cacheDir` to `filesDir` directly targets Android eviction root cause.

```yaml
evidence:
  files:
    - src/lockerDeleteGuard.ts
    - src/lockerDurability.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
  confidence: High
  evidence_type:
    - implementation
```

### Risks / gaps

| Area | Assessment | Confidence |
|------|------------|------------|
| Multi-store drift | IDB blobs, native files, integrity manifest, and `nativeSourcePath` can disagree; heal chain is long and order-dependent | **High** |
| Fast boot playability | `offlineReady` may be optimistic until `refreshLockerPlayabilityFull`; UI could briefly show playable rows that fail at Exo gate | **Medium** |
| Legacy cache survivors | `verifyLockerIntegrityOnBoot` warns if `cacheBlobCount > 0` after migration — audio may still be lost if migration copy fails | **High** |
| Integrity manifest in localStorage | Quota errors silently ignored (`saveManifest` catch); manifest can be empty while IDB has data | **Medium** |
| Remote tombstone semantics | Tombstones export but never delete on peer — deleted tracks on device A remain on device B until explicit local delete | **High** |
| `lockerStorage.ts` surface area | ~5000 lines, god-module tendency; many heal entry points | **Medium** |

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/lockerDurability.ts
    - src/lockerSync.ts
    - src/LockerVaultContext.tsx
  symbols:
    - verifyLockerIntegrityOnBoot
    - saveManifest
    - applyTrackTombstonesFromManifest
  confidence: High
  evidence_type:
    - implementation
```

### Boundary with adjacent subsystems

| Adjacent | Relationship |
|----------|--------------|
| Playback & Queue | Consumes `LockerEntry` → envelope via `ensureLockerPlayable`; does not own IDB writes |
| Acquisition / downloads | Writes via `saveLockerBlob`; `downloadLockerPrecheck` reads playability |
| Provider / search | Catalog search is separate; locker search uses `lockerSearch`, `lockerMirror`, `lockerLibrarySearch` |
| Playlists | `playlistStorage` references `local-{id}` envelopes; vault repair rematches stubs |

```yaml
evidence:
  files:
    - src/play/ensureLockerPlayable.ts
    - src/downloadLockerPrecheck.ts
    - docs/audit/dependencies.md
  confidence: High
  evidence_type:
    - implementation
```

### Test coverage signal

Dedicated tests exist for durability, delete guard, album art inherit, playable filter, sync conflicts, and locker root bridge. Full integration of boot heal ordering is exercised indirectly via E2E/stress scripts (`.locker-playback-stress-report.json` at repo root) — not verified as CI gate in this pass.

```yaml
evidence:
  files:
    - src/lockerDurability.test.ts
    - src/lockerDeleteGuard.test.ts
    - src/lockerPlayableFilter.test.ts
    - src/lockerAlbumArtInherit.test.ts
  confidence: Medium
  evidence_type:
    - implementation
```
