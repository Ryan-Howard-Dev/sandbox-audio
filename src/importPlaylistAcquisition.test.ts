import { describe, expect, it } from 'vitest';
import {
  playlistTrackSearchQuery,
  resolveImportStubsToCatalogTracks,
  stubCatalogSearchQuery,
  stubToCatalogTrack,
  unmatchedImportStubs,
} from './importPlaylistAcquisition';
import type { StoredPlaylist } from './playlistStorage';

function playlist(overrides: Partial<StoredPlaylist> = {}): StoredPlaylist {
  return {
    id: 'pl-1',
    name: 'God Mode',
    description: '',
    tracks: [],
    ...overrides,
  };
}

describe('importPlaylistAcquisition', () => {
  it('builds artist + title search queries from stubs', () => {
    expect(stubCatalogSearchQuery({ title: 'NEW SLAVES', artist: 'Kanye West' })).toBe(
      'Kanye West NEW SLAVES',
    );
  });

  it('lists unmatched stubs only', () => {
    const pl = playlist({
      importTrackStubs: [
        { title: 'NEW SLAVES', artist: 'Kanye West' },
        { title: 'FRIED', artist: '¥$' },
      ],
      tracks: [
        {
          envelopeId: 'env-1',
          title: 'NEW SLAVES',
          artist: 'Kanye West',
          url: 'file://a.mp3',
          durationSeconds: 0,
          provider: 'local-vault',
          transport: 'element-src',
          sourceId: 'local-1',
        },
      ],
    });
    expect(unmatchedImportStubs(pl)).toEqual([{ title: 'FRIED', artist: '¥$' }]);
  });

  it('uses first unmatched stub for playlist search, not playlist name', () => {
    const pl = playlist({
      importTrackStubs: [
        { title: 'FRIED', artist: '¥$' },
        { title: 'NEW SLAVES', artist: 'Kanye West' },
      ],
    });
    expect(playlistTrackSearchQuery(pl)).toBe('¥$ FRIED');
  });

  it('falls back to stub metadata when catalog search is skipped', async () => {
    const stubs = [{ title: 'NEW SLAVES', artist: 'Kanye West' }];
    const { tracks } = await resolveImportStubsToCatalogTracks(stubs, undefined, {
      skipCatalogSearch: true,
    });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toEqual(stubToCatalogTrack(stubs[0]!, 0));
  });
});
