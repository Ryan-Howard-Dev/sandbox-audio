import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rematchPlaylistStubsFromLocker, rematchPlaylistTracksFromLocker } from './playlistStubRematch';
import type { StoredPlaylist } from './playlistStorage';
import type { MediaEnvelope } from './sandboxLayer1';

const { playableIdsMock, resolveMock } = vi.hoisted(() => ({
  playableIdsMock: vi.fn(async (_ids: Iterable<string>) => new Set<string>()),
  resolveMock: vi.fn(async () => null as MediaEnvelope | null),
}));

vi.mock('./lockerStorage', () => ({
  getLockerEntries: vi.fn(async () => []),
  filterPlayableLockerIds: playableIdsMock,
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
    playableIdsMock.mockReset();
    resolveMock.mockReset();
  });

  it('repairs stale playlist sourceId to playable locker copy', async () => {
    playableIdsMock.mockResolvedValue(new Set<string>());
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

  /**
   * Guards the fix for the 10s Playlists-tab freeze: playability was resolved with one
   * lockerEntryIsPlayable() per track, and each of those reads the whole audio blob out of
   * IndexedDB. It must stay a single bulk call no matter how long the playlist is.
   */
  it('resolves playability in one bulk call for the whole playlist', async () => {
    playableIdsMock.mockResolvedValue(new Set(['a', 'b', 'c']));

    const row = (id: string): MediaEnvelope => ({
      envelopeId: `row-${id}`,
      title: `Track ${id}`,
      artist: 'Artist',
      url: 'content://rd.sheepskin.sandboxmusic.locker/' + id,
      durationSeconds: 200,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: id,
    });

    await rematchPlaylistTracksFromLocker({
      id: 'pl-bulk',
      name: 'Bulk',
      description: '',
      tracks: [row('a'), row('b'), row('c')],
    });

    expect(playableIdsMock).toHaveBeenCalledTimes(1);
    expect([...playableIdsMock.mock.calls[0]![0]!]).toEqual(['a', 'b', 'c']);
  });

  it('leaves rows untouched when the bulk set reports them playable', async () => {
    playableIdsMock.mockResolvedValue(new Set(['locker-good']));

    const { playlist: next, repaired } = await rematchPlaylistTracksFromLocker({
      id: 'pl-ok',
      name: 'Fine',
      description: '',
      tracks: [
        {
          envelopeId: 'row-good',
          title: 'FRIED',
          artist: '¥$',
          url: 'content://rd.sheepskin.sandboxmusic.locker/locker-good',
          durationSeconds: 200,
          provider: 'local-vault',
          transport: 'element-src',
          sourceId: 'locker-good',
        },
      ],
    });

    expect(repaired).toBe(0);
    expect(next.tracks[0]?.sourceId).toBe('locker-good');
    expect(resolveMock).not.toHaveBeenCalled();
  });
});
