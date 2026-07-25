import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./podcastCatalog', () => ({
  searchPodcastCatalogShows: vi.fn(),
}));
vi.mock('./audiobookCatalog', () => ({
  searchAudiobookCatalog: vi.fn(),
}));
vi.mock('./archiveOrgSearch', () => ({
  searchArchiveOrgAudiobooks: vi.fn(),
}));
vi.mock('./lockerStorage', () => ({
  getLockerEntriesSnapshot: vi.fn(() => []),
  normalizeLockerKeyPart: (s: string) =>
    (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(),
}));

import { searchPodcastCatalogShows } from './podcastCatalog';
import { searchAudiobookCatalog } from './audiobookCatalog';
import { searchArchiveOrgAudiobooks } from './archiveOrgSearch';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { searchEverything, totalUniversalHits } from './universalSearch';

const mockPods = vi.mocked(searchPodcastCatalogShows);
const mockLegacyBooks = vi.mocked(searchAudiobookCatalog);
const mockBooks = vi.mocked(searchArchiveOrgAudiobooks);
const mockLocker = vi.mocked(getLockerEntriesSnapshot);

beforeEach(() => {
  vi.clearAllMocks();
  mockPods.mockResolvedValue([]);
  mockBooks.mockResolvedValue([]);
  mockLegacyBooks.mockResolvedValue([]);
  mockLocker.mockReturnValue([]);
});

describe('searchEverything', () => {
  it('ignores queries shorter than two characters', async () => {
    const res = await searchEverything('a');
    expect(totalUniversalHits(res)).toBe(0);
    expect(mockPods).not.toHaveBeenCalled();
    expect(mockBooks).not.toHaveBeenCalled();
  });

  it('returns hits from every format for one query', async () => {
    mockPods.mockResolvedValue([
      { id: 'p1', title: 'The Show', author: 'Host', feedUrl: 'u', source: 'itunes' },
    ] as never);
    mockBooks.mockResolvedValue([
      { identifier: 'b1', title: 'The Book', author: 'Writer', artworkUrl: '' },
    ] as never);
    const music = vi.fn().mockResolvedValue([
      { format: 'music', id: 'm1', title: 'The Song', subtitle: 'Band' },
    ]);

    const res = await searchEverything('stephen king', music);
    expect(res.music).toHaveLength(1);
    expect(res.podcast[0].title).toBe('The Show');
    expect(res.audiobook[0].title).toBe('The Book');
    expect(res.failed).toEqual([]);
  });

  it('one failing format does not kill the others', async () => {
    mockPods.mockRejectedValue(new Error('podcast index down'));
    mockBooks.mockResolvedValue([
      { id: 'b1', title: 'Survivor', author: 'A', source: 'librivox', sourceId: '9' },
    ] as never);

    const res = await searchEverything('anything');
    expect(res.failed).toContain('podcast');
    expect(res.audiobook).toHaveLength(1);
  });

  it('leads music with owned locker matches and de-dupes the catalog copy', async () => {
    mockLocker.mockReturnValue([
      { id: 'x1', title: 'Atrocity Exhibition', artist: 'Danny Brown', albumName: 'AE' },
    ] as never);
    const music = vi.fn().mockResolvedValue([
      { format: 'music', id: 'cat-1', title: 'Atrocity Exhibition', subtitle: 'Danny Brown' },
      { format: 'music', id: 'cat-2', title: 'Something Else', subtitle: 'Other' },
    ]);

    const res = await searchEverything('atrocity', music);
    expect(res.music[0].owned).toBe(true);
    expect(res.music.filter((h) => h.title === 'Atrocity Exhibition')).toHaveLength(1);
    expect(res.music.some((h) => h.title === 'Something Else')).toBe(true);
  });

  it('works with no music searcher supplied', async () => {
    const res = await searchEverything('query only');
    expect(res.music).toEqual([]);
    expect(res.failed).not.toContain('music');
  });
});
