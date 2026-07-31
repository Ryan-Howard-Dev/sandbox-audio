import { describe, expect, it } from 'vitest';
import { parseShareLink, shareLinkSearchTerms } from './shareLink';

/*
 * A link is how people actually pass music around. Reading one is separable from fetching from the
 * service that issued it — this turns "someone sent me this album" into something the app can look
 * for in its own sources, and nothing here touches a network.
 */

describe('parseShareLink', () => {
  it('reads a Tidal album link and its share URI', () => {
    expect(parseShareLink('https://tidal.com/browse/album/12345')).toMatchObject({
      service: 'tidal',
      kind: 'album',
      id: '12345',
    });
    expect(parseShareLink('tidal://album/12345')).toMatchObject({
      service: 'tidal',
      kind: 'album',
      id: '12345',
    });
  });

  it('reads Tidal playlists, tracks and artists', () => {
    expect(parseShareLink('https://tidal.com/playlist/abc-def')?.kind).toBe('playlist');
    expect(parseShareLink('https://tidal.com/track/999')?.kind).toBe('track');
    expect(parseShareLink('https://tidal.com/artist/42')?.kind).toBe('artist');
  });

  it('reads Spotify links', () => {
    expect(parseShareLink('https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy')).toMatchObject({
      service: 'spotify',
      kind: 'album',
      id: '4aawyAB9vmqN3uQ7FjRGTy',
    });
    expect(parseShareLink('https://open.spotify.com/playlist/37i9dQ')?.kind).toBe('playlist');
  });

  /* Apple spells the record out in the slug, which is worth more than the id. */
  it('recovers searchable words from an Apple Music slug', () => {
    const link = parseShareLink('https://music.apple.com/gb/album/melt-my-eyez-see-your-future/1614884814');
    expect(link).toMatchObject({ service: 'apple', kind: 'album' });
    expect(shareLinkSearchTerms(link)).toBe('melt my eyez see your future');
  });

  it('treats an Apple link with a track query as a track', () => {
    expect(parseShareLink('https://music.apple.com/gb/album/x/123?i=456')).toMatchObject({
      kind: 'track',
      id: '456',
    });
  });

  it('reads Deezer and Qobuz links', () => {
    expect(parseShareLink('https://www.deezer.com/en/album/12345')).toMatchObject({
      service: 'deezer',
      kind: 'album',
      id: '12345',
    });
    expect(parseShareLink('https://www.qobuz.com/gb-en/album/some-record/abc123')?.service).toBe(
      'qobuz',
    );
  });

  it('reads YouTube playlists, videos and short links', () => {
    expect(parseShareLink('https://www.youtube.com/playlist?list=PL123')).toMatchObject({
      service: 'youtube',
      kind: 'playlist',
      id: 'PL123',
    });
    expect(parseShareLink('https://www.youtube.com/watch?v=abc')).toMatchObject({ kind: 'track' });
    expect(parseShareLink('https://youtu.be/abc')).toMatchObject({ kind: 'track', id: 'abc' });
  });

  /* Bandcamp keeps the artist in the subdomain, so both halves of the name are recoverable. */
  it('recovers artist and title from a Bandcamp link', () => {
    const link = parseShareLink('https://deathgrips.bandcamp.com/album/the-money-store');
    expect(link).toMatchObject({ service: 'bandcamp', kind: 'album' });
    expect(shareLinkSearchTerms(link)).toContain('money store');
  });

  it('reads SoundCloud sets and tracks', () => {
    expect(parseShareLink('https://soundcloud.com/artist/sets/my-mix')?.kind).toBe('playlist');
    expect(parseShareLink('https://soundcloud.com/artist/a-track')?.kind).toBe('track');
  });

  it('reads an Internet Archive item', () => {
    expect(parseShareLink('https://archive.org/details/some_item_1234')).toMatchObject({
      service: 'archive',
      id: 'some_item_1234',
    });
  });

  it('recognises a podcast feed so it can be fetched directly', () => {
    expect(parseShareLink('https://example.com/podcast/feed.xml')).toMatchObject({
      service: 'rss',
      kind: 'podcast',
    });
    expect(parseShareLink('https://example.com/feed/')?.kind).toBe('podcast');
  });

  it('accepts a link pasted without its scheme', () => {
    expect(parseShareLink('tidal.com/album/1')?.service).toBe('tidal');
  });

  /*
   * A bare phrase is not a broken link — the caller should read null as "these are search words",
   * so returning an error shape here would make ordinary searching look like a failure.
   */
  it('returns null for plain text rather than pretending it is a link', () => {
    expect(parseShareLink('denzel curry walkin')).toBeNull();
    expect(parseShareLink('')).toBeNull();
    expect(parseShareLink('   ')).toBeNull();
  });

  it('refuses a non-http scheme', () => {
    expect(parseShareLink('javascript:alert(1)')).toBeNull();
    expect(parseShareLink('file:///etc/passwd')).toBeNull();
  });

  it('returns an unknown service for a link it does not recognise', () => {
    expect(parseShareLink('https://example.com/something')).toMatchObject({
      service: 'unknown',
      kind: 'unknown',
    });
  });
});

describe('shareLinkSearchTerms', () => {
  it('is empty when the link carries only an opaque id', () => {
    expect(shareLinkSearchTerms(parseShareLink('https://tidal.com/album/12345'))).toBe('');
  });

  it('is empty for no link at all', () => {
    expect(shareLinkSearchTerms(null)).toBe('');
  });
});
