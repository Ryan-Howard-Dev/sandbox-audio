# ADR 001: Locker metadata must never be auto-deleted

## Status

Accepted

## Context

The media library subsystem stores user-owned track metadata in IndexedDB (`SandboxMusicCoreDB`) with optional audio blobs. Boot heal, sync pull, and integrity reconciliation must not silently remove library rows. Pass 2 library audit documents explicit production guards against automated deletion, including sync tombstone application that intentionally does nothing on pull.

Operators and users expect offline locker metadata to survive automated maintenance. Accidental mass deletion during heal or sync would be catastrophic for a self-hosted library product.

## Decision

Locker metadata rows **must never be silently deleted** on boot, vault load, playback, or sync heal. Production code enforces:

- `LOCKER_NEVER_AUTO_DELETE` policy constant and `blockLockerAutoDelete` throws in production builds.
- `applyTrackTombstonesFromManifest` returns `0` and logs skip — remote tombstones do not delete local rows on pull.
- User-initiated deletes require `LOCKER_USER_DELETE_CONFIRMED` symbol via `assertLockerUserDeleteConfirmed`.
- Destructive repair (`clearHollowRows`, `deleteEmptyBlobs`) requires `LOCKER_REPAIR_USER_CONFIRMED`.

Missing audio bytes mark rows **hollow** (`markLockerEntryHollow`) rather than deleting metadata.

## Consequences

### Positive

- Strong protection against accidental data loss during automated heal/sync development.
- Hollow-row model preserves album grouping and user metadata for in-place reacquire.
- Cross-device sync is additive on pull; peers do not lose rows from remote delete signals.

### Negative

- Deleted tracks on device A remain on device B until explicit local delete (tombstone export-only semantics).
- `LOCKER_SYNC.md` Phase 3 checklist conflicts with no-op pull behavior — documentation drift documented in Pass 3.
- New code paths that call `store.delete` without guard symbols pose high violation risk.

## Evidence

- `docs/audit/library-invariants.md` — `LOCKER_NEVER_AUTO_DELETE` invariant row; user delete and repair confirmation rows
- `docs/audit/library-analysis.md` — Verified Facts §2 (auto-delete blocked), §4 (hollow rows), §8 (tombstone no-op)
- `docs/audit/architecture-violations.md` — remote tombstones vs `LOCKER_SYNC.md` conflict
- `docs/audit/documentation-drift.md` — LOCKER_SYNC Phase 3 Confirmed drift
