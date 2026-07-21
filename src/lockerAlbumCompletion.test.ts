import { describe, expect, it } from 'vitest';
import type { LockerEntry } from './lockerStorage';
import { groupTracksByEnvelope } from './groupTracksByEnvelope';
import {
  albumHadFullDownloadIntent,
  isLockerAlbumCompletionPending,
  shouldAutoQueueLockerAlbumMissingTracks,
  shouldOfferLockerAlbumCompletion,
  summarizeLockerAlbumMissingTracks,
} from './lockerAlbumCompletion';
import { enqueueDownloadJob, initJobTracks, patchDownloadJob } from './downloadQueue';

function entry(id: string, title: string, offlineReady?: boolean): LockerEntry {
  return {
    id,
    title,
    artist: 'Kanye West',
    albumName: 'DONDA',
    url: offlineReady ? 'content://locker/x' : '',
    addedAt: 1,
    genre: '',
    durationSeconds: 180,
    offlineReady,
  };
}

describe('groupTracksByEnvelope duplicate collapse', () => {
  it('merges same-title rows without release group id', () => {
    const groups = groupTracksByEnvelope([
      entry('a', 'Hurricane', true),
      entry('b', 'Hurricane', false),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries).toHaveLength(2);
    expect(groups[0]?.primary.id).toBe('a');
  });

  it('prefers playable primary even when hollow copy has longer duration', () => {
    const playable = entry('playable', 'Jail', true);
    playable.durationSeconds = 120;
    const hollow = entry('hollow', 'Jail', false);
    hollow.durationSeconds = 360;
    const groups = groupTracksByEnvelope([hollow, playable]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.primary.id).toBe('playable');
  });
});

describe('lockerAlbumCompletion', () => {
  it('detects partial albums with missing playable siblings', () => {
    const tracks = [
      entry('1', 'Hurricane', true),
      entry('2', 'Moon', false),
      entry('3', 'Jail', false),
    ];
    const summary = summarizeLockerAlbumMissingTracks(tracks);
    expect(summary.missingCount).toBe(2);
    expect(summary.playableCount).toBe(1);
    expect(
      shouldAutoQueueLockerAlbumMissingTracks('DONDA', 'Kanye West', tracks),
    ).toBe(true);
    expect(
      shouldOfferLockerAlbumCompletion('DONDA', 'Kanye West', tracks),
    ).toBe(true);
  });

  it('does not auto-queue when entire album is missing without download job', () => {
    const tracks = [entry('1', 'Moon', false), entry('2', 'Jail', false)];
    expect(
      shouldAutoQueueLockerAlbumMissingTracks('DONDA', 'Kanye West', tracks),
    ).toBe(false);
    expect(albumHadFullDownloadIntent('DONDA', 'Kanye West')).toBe(false);
  });

  it('auto-queues all-hollow album stamped Downloaded (cleared job)', () => {
    const tracks = [
      { ...entry('1', 'Moon', false), genre: 'Downloaded' },
      { ...entry('2', 'Jail', false), genre: 'Downloaded' },
    ];
    expect(
      shouldAutoQueueLockerAlbumMissingTracks('DONDA', 'Kanye West', tracks),
    ).toBe(true);
  });

  it('counts undefined offlineReady as missing', () => {
    const tracks = [entry('1', 'Moon', undefined), entry('2', 'Jail', undefined)];
    const summary = summarizeLockerAlbumMissingTracks(tracks);
    expect(summary.missingCount).toBe(2);
  });

  it('treats queued album jobs with tracks as completion pending', () => {
    localStorage.clear();
    const job = enqueueDownloadJob({
      label: 'DONDA',
      artist: 'Kanye West',
      albumTitle: 'DONDA',
      mode: 'album',
      tier: 'best',
      totalTracks: 2,
    });
    initJobTracks(job.id, [
      { id: 't1', title: 'Moon' },
      { id: 't2', title: 'Hurricane' },
    ]);
    expect(isLockerAlbumCompletionPending('DONDA', 'Kanye West')).toBe(true);
  });

  it('does not block scan when album job errored with hollow tracks', () => {
    localStorage.clear();
    const job = enqueueDownloadJob({
      label: 'DONDA',
      artist: 'Kanye West',
      albumTitle: 'DONDA',
      mode: 'album',
      tier: 'best',
      totalTracks: 2,
    });
    patchDownloadJob(job.id, { status: 'error', error: 'network failed' });
    expect(isLockerAlbumCompletionPending('DONDA', 'Kanye West')).toBe(false);
  });
});
