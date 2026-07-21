import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rematchPlaylistStubsFromLocker, rematchPlaylistTracksFromLocker } from './playlistStubRematch';
import type { StoredPlaylist } from './playlistStorage';
import type { MediaEnvelope } from './sandboxLayer1';

const { isPlayableMock, resolveMock } = vi.hoisted(() => ({
  isPlayableMock: vi.fn(async () => false),
  resolveMock: vi.fn(async () => null as MediaEnvelope | null),
}));

vi.mock('./lockerStorage', () => ({
  getLockerEntries: vi.fn(async () => []),
  lockerEntryIsPlayable: isPlayableMock,
  resolveLockerEnvelopeForPlayback: resolveMock,
}));

vi.mock('./platformEnv', () => ({
  isAndroid: () => true,
}));

const lockerTrack = (id: string, title: string, artist: string): MediaEnvelope => ({
  envelopeId: `local-${id}`,
  title,
  artist,
  url: 'blob:test',
  durationSeconds: 200,
  provider: 'local-vault',
  transport: 'element-src',
  sourceId: id,
});

describe('rematchPlaylistStubsFromLocker', () => {
  it('links imported title stubs to locker audio by title and artist', () => {
    const playlist: StoredPlaylist = {
      id: 'pl-1',
      name: 'Imported',
      description: '',
      tracks: [],
      importTrackStubs: [{ title: 'Neon Skyline', artist: 'Artist A' }],
    };
    const { playlist: next, newlyMatched } = rematchPlaylistStubsFromLocker(playlist, [
      lockerTrack('t1', 'Neon Skyline', 'Artist A'),
    ]);
    expect(newlyMatched).toBe(1);
    expect(next.tracks).toHaveLength(1);
    expect(next.tracks[0]?.envelopeId).toBe('local-t1');
  });

  it('does not duplicate tracks already in playlist', () => {
    const existing = lockerTrack('t1', 'Neon Skyline', 'Artist A');
    const playlist: StoredPlaylist = {
      id: 'pl-1',
      name: 'Imported',
      description: '',
      tracks: [existing],
      importTrackStubs: [{ title: 'Neon Skyline', artist: 'Artist A' }],
    };
    const { newlyMatched } = rematchPlaylistStubsFromLocker(playlist, [existing]);
    expect(newlyMatched).toBe(0);
  });
});

describe('rematchPlaylistTracksFromLocker', () => {
  beforeEach(() => {
    isPlayableMock.mockReset();
    resolveMock.mockReset();
  });

  it('repairs stale playlist sourceId to playable locker copy', async () => {
    isPlayableMock.mockResolvedValue(false);
    resolveMock.mockResolvedValue({
      envelopeId: 'local-locker-new',
      title: 'FRIED',
      artist: '¥$',
      url: 'content://rd.sheepskin.sandboxmusic.locker/locker-new',
      durationSeconds: 200,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: 'locker-new',
    });

    const playlist: StoredPlaylist = {
      id: 'pl-god',
      name: 'God Mode',
      description: '',
      tracks: [
        {
          envelopeId: 'playlist-row-fried',
          title: 'FRIED',
          artist: '¥$',
          url: 'blob:dead',
          durationSeconds: 200,
          provider: 'local-vault',
          transport: 'element-src',
          sourceId: 'locker-orphan',
        },
      ],
    };

    const { playlist: next, repaired } = await rematchPlaylistTracksFromLocker(playlist);
    expect(repaired).toBe(1);
    expect(next.tracks[0]?.sourceId).toBe('locker-new');
    expect(next.tracks[0]?.envelopeId).toBe('playlist-row-fried');
    expect(next.tracks[0]?.url).toContain('content://');
  });
});
