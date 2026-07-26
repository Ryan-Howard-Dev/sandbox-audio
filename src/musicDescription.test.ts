import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fetchWithTimeout', () => ({ fetchWithTimeout: vi.fn() }));

import { fetchWithTimeout } from './fetchWithTimeout';
import {
  buildMusicBrainzSearchUrl,
  buildWikipediaSummaryUrl,
  cacheMusicDescription,
  fetchMusicDescription,
  getCachedMusicDescription,
  musicDescriptionKey,
  normalizeMusicQuery,
  parseMusicBrainzMbid,
  parseMusicBrainzRelations,
  parseWikidataEnwikiTitle,
  parseWikipediaExtract,
} from './musicDescription';

function json(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('normalizeMusicQuery', () => {
  it('strips edition noise that tags carry but MusicBrainz does not', () => {
    expect(normalizeMusicQuery('Donda (Deluxe Edition)')).toBe('Donda');
    expect(normalizeMusicQuery('Vultures_1.mp3')).toBe('Vultures 1');
    expect(normalizeMusicQuery('The Real Me [Remastered]')).toBe('The Real Me');
  });
});

describe('buildMusicBrainzSearchUrl', () => {
  it('scopes an album query by release group and artist', () => {
    const url = buildMusicBrainzSearchUrl('album', 'Donda', 'Kanye West');
    expect(url).toContain('release-group');
    expect(decodeURIComponent(url)).toContain('releasegroup:"Donda"');
    expect(decodeURIComponent(url)).toContain('artist:"Kanye West"');
  });

  it('queries the artist entity for a bio', () => {
    const url = buildMusicBrainzSearchUrl('artist', 'Future', '');
    expect(url).toContain('/artist?');
    expect(decodeURIComponent(url)).toContain('artist:"Future"');
  });
});

describe('parseMusicBrainzMbid', () => {
  it('reads the id from the right list per entity', () => {
    expect(parseMusicBrainzMbid('album', { 'release-groups': [{ id: 'rg-1' }] })).toBe('rg-1');
    expect(parseMusicBrainzMbid('artist', { artists: [{ id: 'ar-1' }] })).toBe('ar-1');
  });

  it('returns null on empty or malformed payloads', () => {
    expect(parseMusicBrainzMbid('album', { 'release-groups': [] })).toBeNull();
    expect(parseMusicBrainzMbid('artist', { artists: [{}] })).toBeNull();
    expect(parseMusicBrainzMbid('album', null)).toBeNull();
  });
});

describe('parseMusicBrainzRelations', () => {
  it('extracts a direct Wikipedia title', () => {
    expect(
      parseMusicBrainzRelations({
        relations: [{ type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Donda' } }],
      }).wikipediaTitle,
    ).toBe('Donda');
  });

  it('extracts a Wikidata id when there is no Wikipedia relation', () => {
    const out = parseMusicBrainzRelations({
      relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q107' } }],
    });
    expect(out.wikipediaTitle).toBeNull();
    expect(out.wikidataId).toBe('Q107');
  });

  it('decodes percent-encoded article titles', () => {
    expect(
      parseMusicBrainzRelations({
        relations: [
          { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Wu-Tang%20Clan' } },
        ],
      }).wikipediaTitle,
    ).toBe('Wu-Tang Clan');
  });

  it('ignores unrelated relations', () => {
    const out = parseMusicBrainzRelations({
      relations: [{ type: 'discogs', url: { resource: 'https://discogs.com/x' } }],
    });
    expect(out).toEqual({ wikipediaTitle: null, wikidataId: null });
  });
});

describe('parseWikidataEnwikiTitle', () => {
  it('reads the English sitelink', () => {
    expect(
      parseWikidataEnwikiTitle(
        { entities: { Q107: { sitelinks: { enwiki: { title: 'Donda' } } } } },
        'Q107',
      ),
    ).toBe('Donda');
  });

  it('returns null when there is no English article', () => {
    expect(parseWikidataEnwikiTitle({ entities: { Q107: { sitelinks: {} } } }, 'Q107')).toBeNull();
  });
});

describe('parseWikipediaExtract', () => {
  it('takes the lead extract', () => {
    expect(parseWikipediaExtract({ extract: '  Donda is an album.  ' })).toBe('Donda is an album.');
  });

  it('rejects disambiguation pages, which describe the page not the subject', () => {
    expect(
      parseWikipediaExtract({ type: 'disambiguation', extract: 'Donda may refer to:' }),
    ).toBeNull();
  });

  it('returns null when empty or malformed', () => {
    expect(parseWikipediaExtract({ extract: '   ' })).toBeNull();
    expect(parseWikipediaExtract(null)).toBeNull();
  });
});

describe('buildWikipediaSummaryUrl', () => {
  it('underscores spaces the way article paths expect', () => {
    expect(buildWikipediaSummaryUrl('Wu-Tang Clan')).toContain('Wu-Tang_Clan');
  });
});

describe('fetchMusicDescription', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it('walks MusicBrainz to Wikipedia and returns the extract', async () => {
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('musicbrainz.org/ws/2/release-group?')) {
        return json({ 'release-groups': [{ id: 'rg-1' }] });
      }
      if (u.includes('musicbrainz.org/ws/2/release-group/rg-1')) {
        return json({
          relations: [
            { type: 'wikipedia', url: { resource: 'https://en.wikipedia.org/wiki/Donda' } },
          ],
        });
      }
      return json({ extract: 'Donda is an album by Kanye West.' });
    });

    await expect(fetchMusicDescription('album', 'Donda', 'Kanye West')).resolves.toBe(
      'Donda is an album by Kanye West.',
    );
  });

  it('falls back through Wikidata when there is no Wikipedia relation', async () => {
    const seen: string[] = [];
    vi.mocked(fetchWithTimeout).mockImplementation(async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.includes('/ws/2/artist?')) return json({ artists: [{ id: 'ar-1' }] });
      if (u.includes('/ws/2/artist/ar-1')) {
        return json({
          relations: [{ type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q7' } }],
        });
      }
      if (u.includes('wikidata.org/wiki/Special:EntityData')) {
        return json({ entities: { Q7: { sitelinks: { enwiki: { title: 'Future (rapper)' } } } } });
      }
      return json({ extract: 'Future is an American rapper.' });
    });

    await expect(fetchMusicDescription('artist', 'Future', '')).resolves.toBe(
      'Future is an American rapper.',
    );
    expect(seen.some((u) => u.includes('Special:EntityData'))).toBe(true);
  });

  it('returns a cached hit without touching the network', async () => {
    cacheMusicDescription('album', 'Donda', 'Kanye West', 'Cached blurb.');
    await expect(fetchMusicDescription('album', 'Donda', 'Kanye West')).resolves.toBe(
      'Cached blurb.',
    );
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('caches a miss so an unknown release is not re-queried every open', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(json({ 'release-groups': [] }));
    await expect(fetchMusicDescription('album', 'Home Recording', 'Nobody')).resolves.toBeNull();
    expect(getCachedMusicDescription('album', 'Home Recording', 'Nobody')).toBe('');
  });

  it('does not cache a miss when the lookup itself failed', async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error('offline'));
    await expect(fetchMusicDescription('album', 'Donda', 'Kanye West')).resolves.toBeNull();
    expect(getCachedMusicDescription('album', 'Donda', 'Kanye West')).toBeNull();
  });

  it('keys album and artist separately', () => {
    expect(musicDescriptionKey('album', 'Donda', 'Kanye West')).not.toBe(
      musicDescriptionKey('artist', 'Donda', 'Kanye West'),
    );
  });
});
