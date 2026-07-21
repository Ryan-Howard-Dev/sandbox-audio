# Pass 2 — Media Library & Local Storage Invariants

Subsystem scope: IndexedDB locker vault (`lockerStorage.ts`), vault React context (`LockerVaultContext.tsx`), local library UI (`LocalView.tsx`, locker components), durability manifest (`lockerDurability.ts`), delete guards (`lockerDeleteGuard.ts`), cross-device sync (`lockerSync.ts`), Android native blob store (`LockerBlobRegistry.java`), album art session cache (`albumArtCache.ts`). **Code-only audit — 2026-07-21.**

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| Locker metadata rows must never be silently deleted on boot, vault load, playback, or sync heal | Prevents offline library loss from automated maintenance | `LOCKER_NEVER_AUTO_DELETE` comment policy; `blockLockerAutoDelete` throws in `PROD`; `applyTrackTombstonesFromManifest` returns 0 | **High** if a new code path bypasses guards and calls `store.delete` / `clear` without `LOCKER_USER_DELETE_CONFIRMED` |
| User-initiated track/album delete must pass `LOCKER_USER_DELETE_CONFIRMED` | Ensures destructive actions are explicit | `assertLockerUserDeleteConfirmed` in `removeLockerEntry`, `removeAlbumFromLocker`, `clearLockerVault`; `LocalView` passes symbol from `ConfirmDialog` | **Low** — guarded entry points throw `LockerDeleteBlockedError` |
| Destructive repair (clear hollow rows, delete empty blobs) must pass `LOCKER_REPAIR_USER_CONFIRMED` | Prevents Settings repair from wiping metadata without consent | `assertLockerRepairDestructiveAllowed` in `reconcileLockerBlobIntegrity` | **Medium** — only when `clearHollowRows` or `deleteEmptyBlobs` options set |
| Missing audio bytes must mark row hollow, not delete metadata | Albums remain visible; reacquire can replace bytes in-place | `markLockerEntryHollow` clears flags/URL; `verifyLockerIntegrityOnBoot` calls hollow + `queueDeadLockerTrackReacquire` | **Medium** — stale `hasAudioBlob=true` until integrity pass runs |
| Android locker audio must live in `filesDir/locker_blobs`, not `getCacheDir()` | OS may evict cache under storage pressure | `LockerBlobRegistry.lockerDir` uses `getFilesDir()`; comment "HARD RULE: never store locker audio in getCacheDir()" | **High** for legacy installs — `migrateCacheBlobsToFilesDir` may leave survivors in cache |
| `offlineReady` must reflect real playable bytes, not stale `blob:` URLs | UI and download precheck trust this flag | `enrichLockerEntriesPlayability` revokes dead `blob:` URLs and sets `offlineReady`; `filterPlayableLockerEntries` filters on it | **Medium** — fast boot mode (`lockerEntryFastPlayable`) may be optimistic until full pass |
| IndexedDB `track_blobs` is authoritative for web/desktop playback URLs | Blob store separated at DB v3 migration | `putTrackRowWithBlobs` writes blobs to `track_blobs`; `getLockerAudioBlob` reads from blob store | **Medium** — orphaned blob keys without metadata rows remain until Repair recover |
| Android Exo playback must resolve to `content://` URIs, not WebView `blob:` | Exo cannot reliably play revoked blob URLs | `resolveLockerEnvelopeForPlayback` Android branch uses `healLockerEntryNativePlayback`; `ensureLockerPlayable` rejects Android `blob:` | **High** — if native warm fails, playback returns `missing-audio` despite metadata |
| Remote track tombstones must not auto-delete local rows on manifest pull | Cross-device delete is opt-in locally | `applyTrackTombstonesFromManifest` logs skip, returns 0; tombstones only recorded on local `removeLockerEntry` | **Low** for data loss — **High** for sync semantics confusion (peers diverge) |
| Integrity manifest updates after successful blob write | Boot verify can detect byte loss vs last known state | `recordLockerIntegrityEntry` after `saveLockerBlob`; `verifyLockerIntegrityOnBoot` compares manifest + row flags vs `getLockerAudioBlob` | **Medium** — `saveManifest` swallows localStorage quota errors |
| Boot heavy heal must run after UI interactivity gate | Avoids blocking first tap on large libraries | `scheduleDeferredVaultBoot` → `runAfterBootInteractive`; `reconcileLockerBlobIntegrity({ skipNativeWarm: true })` at boot | **Low** for correctness — heal may lag up to 30s or first input |
| `lockerCache` must notify subscribers on mutation | LocalView and repair panels stay consistent | `notifyLockerCache` / `subscribeLockerCache`; `setLockerCache` on refresh | **Low** — callers using `skipCacheRefresh` must manually refresh |
| Upload must respect device capacity limit | Prevents unbounded IDB growth | `assertLockerCapacityForUpload` / `LockerCapacityExceededError` in `saveLockerBlob`, `saveLockerFilesAsAlbum` | **Medium** — `UNLIMITED` capacity bypasses limit |
| User metadata lock must survive auto-repair and sync pull | Manual edits are authoritative | `userMetadataLocked` on `LockerEntry`; sync manifest carries flag; auto-repair modules check flag | **Medium** — conflict resolution requires user action in `lockerSyncConflicts` |
| ytdlp-locker temp paths must be imported into `track_blobs` for hollow rows | Download may finish on disk before IDB write completes | `healHollowRowsFromYtdlpTemps` matches `nativeSourcePath` with `/ytdlp-locker/` | **High** if app killed before import and temp cleaned externally |
| Android SQLite mirror is derived, not source of truth | Search mirror must rebuild from IDB | `lockerMirror.ts` header: "IndexedDB remains source of truth"; `syncLockerMirror` on vault warm | **Low** — stale mirror until next sync |
| Album art session cache must not override durable vault consensus when sibling art disagrees | Prevents wrong-catalog cover persistence | `resolveLockerAlbumArtSrc` drops poisoned cache when canonical URLs diverge | **Low** — transient wrong art possible until vault refresh |
| Re-download must prefer hollow row replacement over new sibling row | Avoids duplicate title/artist entries | `findLockerEntryForTrackIncludingHollow`; `saveLockerBlob` `replaceEntryId`; `resolveLockerReacquireTargetId` | **Medium** — fuzzy match ambiguity can target wrong row |
| `content://` cache URIs must not be stored as durable `nativeSourcePath` | Pre-repair bug stored ephemeral pointers | `isLockerCacheContentUri`; `repairStaleLockerNativeSourcePaths` clears them | **Medium** on upgrades from older builds |
| `LOCKER_NEVER_AUTO_DELETE` prune functions must not run in production | `pruneHollowLockerEntriesFromStorage` / `pruneMetadataOnlyLockerDuplicates` call `blockLockerAutoDelete` | Grep in `lockerStorage.ts` lines ~2901, ~3167 | **Low** in prod — dev builds only log warning |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - src/lockerStorage.ts
    - src/lockerDurability.ts
    - src/lockerDeleteGuard.ts
    - src/lockerSync.ts
    - src/LockerVaultContext.tsx
    - src/play/ensureLockerPlayable.ts
    - src/albumArtCache.ts
    - android/app/src/main/java/rd/sheepskin/sandboxmusic/LockerBlobRegistry.java
  symbols:
    - markLockerEntryHollow
    - verifyLockerIntegrityOnBoot
    - reconcileLockerBlobIntegrity
    - applyTrackTombstonesFromManifest
    - enrichLockerEntriesPlayability
    - healHollowRowsFromYtdlpTemps
  confidence: High
  evidence_type:
    - implementation
    - storage
```
