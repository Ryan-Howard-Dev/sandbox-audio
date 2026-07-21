import { describe, expect, it } from 'vitest';
import type { ResolvedSearchHit } from './sandboxLayer2';
import { buildAlbumRenderRows } from './stations/SearchResultsView';
import type { CatalogTrack } from './searchCatalog';

function mkTrack(overrides: Partial<CatalogTrack>): CatalogTrack {
  return {
    kind: 'track',
    id: 'track-1',
    title: 'Track',
    artist: 'Slipknot',
    album: 'Slipknot (25th Anniversary Edition)',
    ...overrides,
  };
}

function mkHit(title: string, id: string): ResolvedSearchHit {
  return {
    identityId: id,
    title,
    artist: 'Slipknot',
    sources: [],
    primaryEnvelope: {
      envelopeId: id,
      title,
      artist: 'Slipknot',
      url: 'https://audio.example/preview.m4a',
      durationSeconds: 180,
      provider: 'https',
      transport: 'element-src',
      sourceId: id.replace('catalog-', ''),
    },
  };
}

describe('buildAlbumRenderRows partial album display', () => {
  it('renumbers display indices when catalog track numbers have gaps', () => {
    const albumTracks = [
      mkTrack({ id: 'track-28', title: 'A', trackNumber: 28 }),
      mkTrack({ id: 'track-30', title: 'B', trackNumber: 30 }),
      mkTrack({ id: 'track-31', title: 'C', trackNumber: 31 }),
    ];
    const hits = albumTracks.map((track) => mkHit(track.title, track.id));

    const rows = buildAlbumRenderRows(hits, albumTracks, albumTracks[0]!.album, 32);
    const trackRows = rows.filter((row) => row.kind === 'track');
    expect(trackRows).toHaveLength(3);
    expect(trackRows.map((row) => row.displayIndex)).toEqual([1, 2, 3]);
  });

  it('keeps original track numbers when the list is contiguous', () => {
    const albumTracks = [
      mkTrack({ id: 'track-1', title: 'A', trackNumber: 1 }),
      mkTrack({ id: 'track-2', title: 'B', trackNumber: 2 }),
      mkTrack({ id: 'track-3', title: 'C', trackNumber: 3 }),
    ];
    const hits = albumTracks.map((track) => mkHit(track.title, track.id));

    const rows = buildAlbumRenderRows(hits, albumTracks, albumTracks[0]!.album, 3);
    const trackRows = rows.filter((row) => row.kind === 'track');
    expect(trackRows.map((row) => row.displayIndex)).toEqual([1, 2, 3]);
  });

  it('does not append unrelated search hits after the album tracklist', () => {
    const albumTracks = [
      mkTrack({ id: 'track-1', title: 'Draco', trackNumber: 1 }),
      mkTrack({ id: 'track-2', title: 'Mask Off', trackNumber: 2 }),
    ];
    const hits = [
      ...albumTracks.map((track) => mkHit(track.title, track.id)),
      mkHit('SexyBack', 'catalog-sexyback'),
      mkHit('Zone', 'catalog-zone'),
    ];

    const rows = buildAlbumRenderRows(hits, albumTracks, 'FUTURE', 2);
    const trackRows = rows.filter((row) => row.kind === 'track');
    expect(trackRows).toHaveLength(2);
    expect(trackRows.map((row) => row.hit.title)).toEqual(['Draco', 'Mask Off']);
  });

  it('returns no rows when album metadata exists but track fetch is empty', () => {
    const rows = buildAlbumRenderRows(
      [mkHit('SexyBack', 'catalog-sexyback')],
      [],
      'ZONE',
      0,
    );
    expect(rows).toHaveLength(0);
  });
});
