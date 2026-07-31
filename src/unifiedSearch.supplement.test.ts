import { describe, expect, it, vi } from 'vitest';
import type { CatalogSearchResult, CatalogTrack } from './searchCatalog';

// The web-catalog merge has its own tests; here it stands in as a source of ranked web rows so
// these assertions are about how the two streams get fused, not about how yt-dlp results are built.
vi.mock('./webCatalogSearch', () => ({
  mergeWebCatalogResults: (
    catalog: CatalogSearchResult,
    webTracks: CatalogTrack[],
  ): CatalogSearchResult => ({
    ...catalog,
    tracks: [...webTracks, ...catalog.tracks],
  }),
}));

const { EMPTY_UNIFIED, applyWebSupplementToUnified } = await import('./unifiedSearch');

function track(id: string, title = id): CatalogTrack {
  return { kind: 'track', id, title, artist: 'Test Artist' };
}

function catalogTracks(count: number): CatalogTrack[] {
  return Array.from({ length: count }, (_, i) => track(`itunes-${i + 1}`));
}

function webTracks(count: number): CatalogTrack[] {
  return Array.from({ length: count }, (_, i) => track(`youtube-${i + 1}`));
}

function unifiedWith(tracks: CatalogTrack[]) {
  return { ...EMPTY_UNIFIED, tracks, catalog: { ...EMPTY_UNIFIED.catalog, tracks } };
}

describe('applyWebSupplementToUnified', () => {
  it('keeps catalog rows when the web supplement returns a full page', () => {
    // The regression this fixes: web rows were prepended and the list sliced to twelve, so twelve
    // YouTube hits erased every iTunes row no matter how well it matched.
    const result = applyWebSupplementToUnified(unifiedWith(catalogTracks(20)), webTracks(12), 'q');
    const ids = result.tracks.map((t) => t.id);
    expect(ids.some((id) => id.startsWith('itunes-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('youtube-'))).toBe(true);
  });

  it('leads with the catalog but still surfaces the web supplement in the visible rows', () => {
    const result = applyWebSupplementToUnified(unifiedWith(catalogTracks(20)), webTracks(12), 'q');
    const top = result.tracks.slice(0, 12).map((t) => t.id);
    expect(top[0]).toBe('itunes-1');
    // The 1.1 catalog weight lands the web leader around the catalog's eighth row; the exact
    // position can move with the weight, but it must stay inside the twelve the user sees.
    expect(top).toContain('youtube-1');
  });

  it('preserves each source\'s own ordering', () => {
    const result = applyWebSupplementToUnified(unifiedWith(catalogTracks(6)), webTracks(6), 'q');
    const ids = result.tracks.map((t) => t.id);
    const catalogOrder = ids.filter((id) => id.startsWith('itunes-'));
    const webOrder = ids.filter((id) => id.startsWith('youtube-'));
    expect(catalogOrder).toEqual(['itunes-1', 'itunes-2', 'itunes-3', 'itunes-4', 'itunes-5', 'itunes-6']);
    expect(webOrder).toEqual([
      'youtube-1',
      'youtube-2',
      'youtube-3',
      'youtube-4',
      'youtube-5',
      'youtube-6',
    ]);
  });

  it('returns the input untouched when there is nothing to supplement', () => {
    const unified = unifiedWith(catalogTracks(3));
    expect(applyWebSupplementToUnified(unified, [], 'q')).toBe(unified);
  });

  it('carries the web supplement alone when the catalog found nothing', () => {
    // A bootleg or mixtape iTunes has never heard of is exactly why the supplement exists.
    const result = applyWebSupplementToUnified(unifiedWith([]), webTracks(4), 'q');
    expect(result.tracks.map((t) => t.id)).toEqual([
      'youtube-1',
      'youtube-2',
      'youtube-3',
      'youtube-4',
    ]);
  });

  it('adds the tracks section once rows exist', () => {
    const result = applyWebSupplementToUnified(unifiedWith([]), webTracks(2), 'q');
    expect(result.sections).toContain('tracks');
  });

  it('does not duplicate a row that both streams returned', () => {
    const shared = track('itunes-1');
    const result = applyWebSupplementToUnified(unifiedWith([shared]), [shared], 'q');
    expect(result.tracks.filter((t) => t.id === 'itunes-1')).toHaveLength(1);
  });
});
