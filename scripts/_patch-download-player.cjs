const fs = require('fs');
const root = 'C:/Users/RH/Downloads/sovereign-music-console/src';

function patch(file, fn) {
  const p = `${root}/${file}`;
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('patched', file);
  } else console.log('no change', file);
}

patch('downloadLockerPrecheck.ts', (s) => {
  if (s.includes('lockerEntryHasHealSignals')) return s;
  s = s.replace(
    "import { findPlayableLockerEntryForTrack, getLockerEntries, tracksForAlbumGroup } from './lockerStorage';",
    `import {
  findPlayableLockerEntryForTrack,
  findLockerEntryForTrackIncludingHollow,
  lockerEntryHasHealSignals,
  getLockerEntries,
  tracksForAlbumGroup,
} from './lockerStorage';`,
  );
  const old = `    if (playable) {
      skipped += 1;
      continue;
    }
    needing.push(track);`;
  const neu = `    if (playable) {
      skipped += 1;
      continue;
    }
    const hollow = findLockerEntryForTrackIncludingHollow(
      track.title,
      track.artist,
      albumName ?? track.album,
    );
    if (hollow && (await lockerEntryHasHealSignals(hollow.id))) {
      skipped += 1;
      continue;
    }
    needing.push(track);`;
  if (!s.includes(old)) throw new Error('downloadLockerPrecheck anchor missing');
  return s.replace(old, neu);
});

patch('lockerAlbumCompletion.ts', (s) => {
  if (s.includes('filterTracksNeedingDownload')) return s;
  s = s.replace(
    "} from './downloadQueue';",
    `} from './downloadQueue';
import { filterTracksNeedingDownload } from './downloadLockerPrecheck';`,
  );
  const old = `  const catalogTracks = await catalogTracksForMissing(
    albumName,
    albumArtist,
    summary.missingTitles,
  );
  if (catalogTracks.length === 0) return undefined;

  const job =
    existing && existing.status !== 'done'
      ? existing
      : enqueueDownloadJob({
          label: albumName,
          artist: albumArtist,
          albumTitle: albumName,
          mode: 'album',
          tier,
          totalTracks: catalogTracks.length,
        });`;
  const neu = `  const catalogTracks = await catalogTracksForMissing(
    albumName,
    albumArtist,
    summary.missingTitles,
  );
  if (catalogTracks.length === 0) return undefined;

  const precheck = await filterTracksNeedingDownload(catalogTracks, albumName);
  if (precheck.needing.length === 0) return undefined;
  const tracksToAcquire = precheck.needing;

  const job =
    existing && existing.status !== 'done'
      ? existing
      : enqueueDownloadJob({
          label: albumName,
          artist: albumArtist,
          albumTitle: albumName,
          mode: 'album',
          tier,
          totalTracks: tracksToAcquire.length,
        });`;
  if (!s.includes(old)) throw new Error('lockerAlbumCompletion anchor1 missing');
  s = s.replace(old, neu);
  s = s.replace(
    `    catalogTracks.map((t) => ({ id: t.id, title: t.title })),`,
    `    tracksToAcquire.map((t) => ({ id: t.id, title: t.title })),`,
  );
  s = s.replace(
    'await acquireTracksOnServer(catalogTracks, {',
    'await acquireTracksOnServer(tracksToAcquire, {',
  );
  return s;
});

patch('downloadJobReconcile.ts', (s) => {
  if (s.includes('reconcilePausedDownloadJobsWithLocker')) return s;
  s += `

/** Mark paused/error album jobs done when locker already covers catalog (incl. heal signals). */
export async function reconcilePausedDownloadJobsWithLocker(): Promise<number> {
  let reconciled = 0;
  for (const job of getDownloadJobs()) {
    if (job.status === 'done') continue;
    if (job.mode !== 'album' || !job.albumTitle) continue;
    const listing = await fetchAlbumTracks({
      kind: 'album',
      id: job.albumId ?? job.id,
      title: job.albumTitle,
      artist: job.artist,
    });
    if (listing.length === 0) continue;
    const precheck = await filterTracksNeedingDownload(listing, job.albumTitle);
    if (precheck.needing.length > 0) continue;
    patchDownloadJob(job.id, {
      status: 'done',
      progress: 100,
      completedTracks: listing.length,
      currentTrack: undefined,
      error: undefined,
    });
    reconciled += 1;
  }
  return reconciled;
}
`;
  return s;
});

patch('acquisitionPipeline.ts', (s) => {
  if (s.includes('reconcilePausedDownloadJobsWithLocker')) return s;
  s = s.replace(
    "import { filterTracksNeedingDownload } from './downloadLockerPrecheck';",
    `import { filterTracksNeedingDownload } from './downloadLockerPrecheck';
import { reconcilePausedDownloadJobsWithLocker } from './downloadJobReconcile';`,
  );
  if (!s.includes("import { filterTracksNeedingDownload }")) {
    s = s.replace(
      "import { scheduleDownloadJob } from './downloadQueueRunner';",
      `import { scheduleDownloadJob } from './downloadQueueRunner';
import { reconcilePausedDownloadJobsWithLocker } from './downloadJobReconcile';`,
    );
  }
  const old = `    await revalidateDownloadQueueAgainstLocker();
    const needing = listDownloadJobsNeedingResume().filter(`;
  const neu = `    await revalidateDownloadQueueAgainstLocker();
    await reconcilePausedDownloadJobsWithLocker();
    const needing = listDownloadJobsNeedingResume().filter(`;
  if (!s.includes(old)) throw new Error('autoResume anchor missing');
  return s.replace(old, neu);
});

patch('mobile/MobilePlayerShell.tsx', (s) => {
  const old = 'tidalMini={combinedDock && showMiniBar && !showInfoStrip}';
  const neu = 'tidalMini={showMiniBar && !showInfoStrip && (combinedDock || inlineDock)}';
  return s.replace(old, neu);
});

patch('stations/LocalView.tsx', (s) => {
  const marker = '  useEffect(() => {\n    if (!selectedAlbum || !hydrated || !offerAlbumCompletion) return;';
  if (!s.includes(marker)) return s;
  if (s.includes('AUTO_COMPLETE_ALBUM_DOWNLOADS')) return s;
  const end = `  }, [
    selectedAlbum?.key,
    selectedAlbum?.name,
    selectedAlbum?.artist,
    selectedAlbum?.tracks,
    hydrated,
    offerAlbumCompletion,
    selectedAlbumMissing.missingCount,
    t,
  ]);`;
  const idx = s.indexOf(marker);
  const endIdx = s.indexOf(end, idx);
  if (endIdx < 0) throw new Error('LocalView auto-complete block not found');
  const replacement = `  // Album completion is manual only — auto-queue re-downloaded hollow vault rows on open.
  useEffect(() => {
    if (!selectedAlbum || !hydrated || !offerAlbumCompletion) return;
    autoCompleteAttemptedRef.current.add(selectedAlbum.key);
  }, [
    selectedAlbum?.key,
    hydrated,
    offerAlbumCompletion,
  ]);`;
  return s.slice(0, idx) + replacement + s.slice(endIdx + end.length);
});

const gradle = 'C:/Users/RH/Downloads/sovereign-music-console/android/app/build.gradle';
let g = fs.readFileSync(gradle, 'utf8');
g = g.replace(/versionCode\s+\d+/, 'versionCode 49');
g = g.replace(/versionName\s+"[^"]+"/, 'versionName "0.49.0"');
fs.writeFileSync(gradle, g);
console.log('bumped version to 49');
