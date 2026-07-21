/**
 * Scan and repair locker rows that have metadata but no playable audio bytes.
 */

import { repairAllPlaylistsFromLocker } from './playlistStubRematch';
import { loadPlaylists, savePlaylists } from './playlistStorage';
import { ensureDownloadedAlbumCover } from './lockerAlbumBackfill';
import {
  auditLockerVaultHealth,
  getLockerEntries,
  lockerArtistMatches,
  lockerEntryIsPlayable,
  lockerTitleMatches,
  reconcileLockerBlobIntegrity,
  recoverOrphanedLockerBlobs,
  refreshLockerCache,
  warmLockerNativePlaybackCache,
  type LockerBlobIntegrityReport,
  type LockerEntry,
  type LockerVaultHealthReport,
} from './lockerStorage';

export type MetadataOnlyLockerIssue = {
  id: string;
  title: string;
  artist: string;
  albumName?: string;
  addedAt: number;
  hasPlayableSibling: boolean;
  siblingId?: string;
};

export type MetadataOnlyLockerScan = {
  totalTracks: number;
  playableTracks: number;
  metadataOnlyCount: number;
  duplicateMetadataOnlyCount: number;
  issues: MetadataOnlyLockerIssue[];
};

export type MetadataOnlyLockerRepairResult = {
  scanned: number;
  removed: number;
  prunedDuplicates: number;
  recoveredBlobs: number;
  integrity: LockerBlobIntegrityReport;
  health: LockerVaultHealthReport;
  remainingMetadataOnly: number;
  playlistsRepaired: number;
};

function findPlayableSibling(
  entry: LockerEntry,
  playableByKey: Map<string, LockerEntry>,
): LockerEntry | undefined {
  const albumKey = (entry.albumName ?? '').trim().toLowerCase();
  const keys = [
    `${albumKey}|${entry.title}|${entry.artist}`,
    `|${entry.title}|${entry.artist}`,
  ];
  for (const key of keys) {
    const hit = playableByKey.get(key);
    if (hit && hit.id !== entry.id) return hit;
  }
  for (const candidate of playableByKey.values()) {
    if (candidate.id === entry.id) continue;
    if (!lockerTitleMatches(candidate.title, entry.title)) continue;
    if (!lockerArtistMatches(candidate.artist, entry.artist)) continue;
    if (albumKey && (candidate.albumName ?? '').trim().toLowerCase() !== albumKey) continue;
    return candidate;
  }
  return undefined;
}

/** List locker rows with no IndexedDB / native audio bytes. */
export async function scanMetadataOnlyLockerTracks(
  entries?: LockerEntry[],
): Promise<MetadataOnlyLockerScan> {
  const list = entries ?? (await getLockerEntries());
  const playableByKey = new Map<string, LockerEntry>();
  const playability = new Map<string, boolean>();

  for (const entry of list) {
    const playable = await lockerEntryIsPlayable(entry.id);
    playability.set(entry.id, playable);
    if (!playable) continue;
    const albumKey = (entry.albumName ?? '').trim().toLowerCase();
    playableByKey.set(`${albumKey}|${entry.title}|${entry.artist}`, entry);
    playableByKey.set(`|${entry.title}|${entry.artist}`, entry);
  }

  const issues: MetadataOnlyLockerIssue[] = [];
  let playableTracks = 0;

  for (const entry of list) {
    if (playability.get(entry.id)) {
      playableTracks += 1;
      continue;
    }
    const sibling = findPlayableSibling(entry, playableByKey);
    issues.push({
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      albumName: entry.albumName,
      addedAt: entry.addedAt,
      hasPlayableSibling: Boolean(sibling),
      siblingId: sibling?.id,
    });
  }

  const duplicateMetadataOnlyCount = issues.filter((i) => i.hasPlayableSibling).length;

  return {
    totalTracks: list.length,
    playableTracks,
    metadataOnlyCount: issues.length,
    duplicateMetadataOnlyCount,
    issues: issues.sort((a, b) => b.addedAt - a.addedAt),
  };
}

/** Recover orphaned blobs, warm native cache, then optionally remove hollow rows. */
export async function recoverLockerVaultAudio(): Promise<{
  recoveredBlobs: number;
  warmed: number;
  health: LockerVaultHealthReport;
}> {
  const recoveredBlobs = await recoverOrphanedLockerBlobs();
  await reconcileLockerBlobIntegrity();
  const warmed = await warmLockerNativePlaybackCache();
  await refreshLockerCache({ hard: true });
  const health = await auditLockerVaultHealth();
  return { recoveredBlobs, warmed, health };
}

/** Recover orphaned blobs and warm cache — NEVER remove locker rows or audio. */
export async function repairMetadataOnlyLockerTracks(options?: {
  /** @deprecated Ignored — hard rule: never delete locker tracks. */
  duplicatesOnly?: boolean;
  /** Re-fetch missing album covers after cleanup. */
  repairCovers?: boolean;
}): Promise<MetadataOnlyLockerRepairResult> {
  const recovery = await recoverLockerVaultAudio();
  const scan = await scanMetadataOnlyLockerTracks();

  // HARD RULE: never call removeLockerEntry / pruneHollow / deleteEmptyBlobs here.
  // Hollow rows stay visible so the user can re-download; blobs are only healed/recovered.
  const integrity = await reconcileLockerBlobIntegrity({
    clearHollowRows: false,
    deleteEmptyBlobs: false,
  });
  await refreshLockerCache({ hard: true });

  const albumsForCover = new Set<string>();
  if (options?.repairCovers !== false) {
    for (const issue of scan.issues) {
      const album = issue.albumName?.trim();
      if (album) albumsForCover.add(album);
    }
    for (const albumName of albumsForCover) {
      try {
        await ensureDownloadedAlbumCover({ albumName });
      } catch {
        /* optional */
      }
    }
    await refreshLockerCache();
  }

  const remaining = await scanMetadataOnlyLockerTracks();
  let playlistsRepaired = 0;
  const lockerTracks = (await getLockerEntries())
    .filter((e) => e.url?.trim() || e.offlineReady)
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
  const { playlists, tracksRepaired, stubsMatched } = await repairAllPlaylistsFromLocker(
    loadPlaylists(),
    lockerTracks,
  );
  playlistsRepaired = tracksRepaired + stubsMatched;
  if (playlistsRepaired > 0) savePlaylists(playlists);

  return {
    scanned: scan.totalTracks,
    removed: 0,
    prunedDuplicates: 0,
    recoveredBlobs: recovery.recoveredBlobs,
    integrity,
    health: await auditLockerVaultHealth(),
    remainingMetadataOnly: remaining.metadataOnlyCount,
    playlistsRepaired,
  };
}
