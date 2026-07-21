import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { initLockerAutoFollow } from './lockerAutoFollow';
import { initCollaborativePlaylistSync } from './playlistCollaborativeShare';
import { initPlaylistSyncPushListener, initTrackTombstonePushListener, pullMissingLockerBlobsFromRemote } from './lockerSync';
import { initLockerBackgroundSync } from './lockerBackgroundSync';
import { repairAllPlaylistsFromLocker } from './playlistStubRematch';
import { loadPlaylists, savePlaylists } from './playlistStorage';
import { syncLockerMirror } from './lockerMirror';
import {
  getLockerEntriesSnapshot,
  backfillLockerBlobStoreFromNativePaths,
  healHollowRowsFromYtdlpTemps,
  healInheritedAlbumArtToStorage,
  reconcileLockerBlobIntegrity,
  recoverOrphanedLockerBlobs,
  refreshLockerCache,
  refreshLockerPlayabilityFull,
  repairLockerDurations,
  repairDurableNativeSourcePaths,
  repairStaleLockerNativeSourcePaths,
  subscribeLockerCache,
  warmLockerCache,
  type LockerEntry,
} from './lockerStorage';
import { runAfterBootInteractive } from './bootInteractivity';
import { revalidateDownloadQueueAgainstLocker } from './downloadQueue';
import { autoResumePausedDownloadJobs } from './acquisitionPipeline';
import { runSessionStubRepairIfNeeded } from './libraryMetadataAutoRepair';

type LockerVaultValue = {
  entries: LockerEntry[];
  ready: boolean;
  refresh: () => Promise<LockerEntry[]>;
};

const LockerVaultContext = createContext<LockerVaultValue | null>(null);

import { repairLockerAlbumGrouping } from './lockerAlbumBackfill';

/** Backfill track durations and missing album artwork after vault load. */
export async function repairLockerVault(): Promise<void> {
  const list = await refreshLockerCache();
  await repairLockerDurations(list);
  await healInheritedAlbumArtToStorage();
  await repairLockerAlbumGrouping();
  await refreshLockerCache();
}

function scheduleDeferredVaultBoot(run: () => Promise<void>): void {
  runAfterBootInteractive(() => {
    void run().catch((err) => console.warn('[locker] deferred boot failed:', err));
  });
}

/** Heavy heal / integrity passes — chunked off the critical UI path. */
async function runDeferredVaultBoot(
  onEntries: (entries: LockerEntry[]) => void,
  repairPlaylistsFromLocker: (entries: LockerEntry[]) => void,
): Promise<void> {
  const { yieldToMain } = await import('./yieldToMain');

  await recoverOrphanedLockerBlobs();
  await yieldToMain();
  await repairStaleLockerNativeSourcePaths();
  await yieldToMain();
  await repairDurableNativeSourcePaths();
  await yieldToMain();
  await backfillLockerBlobStoreFromNativePaths();
  await yieldToMain();
  await healHollowRowsFromYtdlpTemps();
  await yieldToMain();
  await reconcileLockerBlobIntegrity({ skipNativeWarm: true });
  await yieldToMain();

  const integrity = await import('./lockerDurability').then((m) =>
    m.verifyLockerIntegrityOnBoot(),
  );
  if (integrity.markedHollow > 0 || integrity.reacquireQueued > 0) {
    console.info('[lockerDurability] boot integrity', integrity);
  }
  await yieldToMain();

  // Native Exo warm runs on-demand at playback (ensureLockerPlayable) — not at boot.

  const list = getLockerEntriesSnapshot() ?? (await refreshLockerCache({ hard: true }));
  onEntries(list);
  void repairLockerDurations(list);
  void syncLockerMirror(list);
  void revalidateDownloadQueueAgainstLocker().then(() => autoResumePausedDownloadJobs());
  repairPlaylistsFromLocker(list);
  void healInheritedAlbumArtToStorage();
  void runSessionStubRepairIfNeeded();

  void pullMissingLockerBlobsFromRemote().then((r) => {
    if (r.pulled > 0) {
      void refreshLockerCache().then((fresh) => {
        onEntries(fresh);
        void syncLockerMirror(fresh);
      });
    }
    if (r.pulled > 0 || r.deleted > 0) {
      repairPlaylistsFromLocker(getLockerEntriesSnapshot() ?? list);
    }
    if (
      r.playlistsImported > 0 ||
      r.playlistsMerged > 0 ||
      r.playlistsDeleted > 0 ||
      r.pulled > 0
    ) {
      console.info('[lockerSync] playlist replication', {
        pulled: r.pulled,
        deleted: r.deleted,
        playlistsImported: r.playlistsImported,
        playlistsMerged: r.playlistsMerged,
        playlistsDeleted: r.playlistsDeleted,
        conflictsResolved: r.conflictsResolved,
      });
    }
  });
}

export function LockerVaultProvider({ children }: { children: React.ReactNode }) {
  const snap = getLockerEntriesSnapshot();
  const [entries, setEntries] = useState<LockerEntry[]>(() => snap ?? []);
  const [ready, setReady] = useState(() => snap !== null);

  useEffect(() => {
    const repairPlaylistsFromLocker = (vaultEntries: LockerEntry[]) => {
      const lockerTracks = vaultEntries
        .filter((e) => e.offlineReady === true)
        .map((e) => ({
          envelopeId: `local-${e.id}`,
          title: e.title,
          artist: e.artist,
          album: e.albumName,
          url: e.url,
          durationSeconds: e.durationSeconds || 210,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: e.id,
        }));
      void repairAllPlaylistsFromLocker(loadPlaylists(), lockerTracks).then(
        ({ playlists: next, stubsMatched, tracksRepaired }) => {
          if (stubsMatched > 0 || tracksRepaired > 0) {
            savePlaylists(next);
            console.info('[lockerSync] playlist locker repair', {
              stubsMatched,
              tracksRepaired,
            });
          }
        },
      );
    };

    const sync = () => {
      const next = getLockerEntriesSnapshot();
      if (next) {
        setEntries(next);
        setReady(true);
      }
    };
    sync();
    void warmLockerCache()
      .then((list) => {
        setEntries(list);
        setReady(true);
        void syncLockerMirror(list);
        scheduleDeferredVaultBoot(() =>
          runDeferredVaultBoot((fresh) => {
            setEntries(fresh);
            setReady(true);
          }, repairPlaylistsFromLocker),
        );
        runAfterBootInteractive(() => {
          void refreshLockerPlayabilityFull().catch((err) =>
            console.warn('[locker] full playability refresh failed:', err),
          );
        });
      })
      .catch(() => setReady(true));
    const unsubLocker = subscribeLockerCache(sync);

    let stopBackgroundSync: (() => void) | null = null;
    let stopAutoFollow: (() => void) | null = null;
    runAfterBootInteractive(() => {
      initPlaylistSyncPushListener();
      initTrackTombstonePushListener();
      initCollaborativePlaylistSync();
      stopBackgroundSync = initLockerBackgroundSync();
      stopAutoFollow = initLockerAutoFollow();
    });

    return () => {
      unsubLocker();
      stopAutoFollow?.();
      stopBackgroundSync?.();
    };
  }, []);

  const refresh = useCallback(async () => {
    const list = await refreshLockerCache();
    setEntries(list);
    setReady(true);
    void syncLockerMirror(list);
    return list;
  }, []);

  const value = useMemo(
    () => ({ entries, ready, refresh }),
    [entries, ready, refresh],
  );

  return (
    <LockerVaultContext.Provider value={value}>{children}</LockerVaultContext.Provider>
  );
}

export function useLockerVault(): LockerVaultValue {
  const ctx = useContext(LockerVaultContext);
  if (!ctx) {
    throw new Error('useLockerVault must be used inside LockerVaultProvider');
  }
  return ctx;
}
