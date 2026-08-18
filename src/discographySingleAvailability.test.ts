/**
 * Singles greyed out before anything went looking for them.
 *
 * Reported from the phone: some singles on an artist page are dimmed and cannot be downloaded.
 * They are the ones MusicBrainz lists and the iTunes catalog does not stock -- mixtape cuts,
 * loose singles, one-off features. Those came back as a track with no envelope, and the artist
 * page reads a missing envelope as proof the track cannot be had: the row is dimmed to 40%, Play
 * and Cache vanish from its menu, and the label says "unavailable".
 *
 * Nothing had been tried at that point. The download path never looked at the envelope at all --
 * it resolves by title and artist on the server -- so the row was refusing an action that would
 * have worked.
 */

import { describe, expect, it } from 'vitest';
import { catalogTrackPlayEnvelope, unmatchedDiscographySingle } from './searchCatalog';
import type { CatalogTrack } from './searchCatalog';

describe('a single the catalog does not stock', () => {
  const single = unmatchedDiscographySingle(
    '13LOOD 1N + 13LOOD OUT MIXX',
    'Denzel Curry',
    'e8f1a0c2-0000-4000-8000-000000000001',
    '2018',
  );

  it('comes back playable rather than dimmed', () => {
    expect(single.envelope).toBeDefined();
    expect(single.envelope!.title).toBe('13LOOD 1N + 13LOOD OUT MIXX');
    expect(single.envelope!.artist).toBe('Denzel Curry');
  });

  it('carries no URL, because the catalog never does either', () => {
    // The play URL is found at the tap, by title and artist. Shipping one here would be a claim
    // about where the audio is that nothing has checked.
    expect(single.envelope!.url).toBe('');
    expect(single.envelope!.provider).toBe('https');
  });

  it('keeps what MusicBrainz knew about it', () => {
    expect(single.releaseYear).toBe('2018');
    expect(single.id).toBe('mb-single-e8f1a0c2-0000-4000-8000-000000000001');
  });
});

describe('catalogTrackPlayEnvelope', () => {
  it('leaves a track that already has one alone', () => {
    const envelope = {
      envelopeId: 'catalog-1',
      title: 'Ultimate',
      artist: 'Denzel Curry',
      url: '',
      durationSeconds: 179,
      provider: 'https' as const,
      transport: 'element-src' as const,
      sourceId: '1',
    };
    const track: CatalogTrack = { kind: 'track', id: 'catalog-1', title: 'Ultimate', artist: 'Denzel Curry', envelope };
    expect(catalogTrackPlayEnvelope(track)).toBe(envelope);
  });

  it('builds one from the row for a track that has none', () => {
    const track: CatalogTrack = {
      kind: 'track',
      id: 'mb-single-abc',
      title: 'Threatz',
      artist: 'Denzel Curry',
      album: 'Nostalgic 64',
      artworkUrl: 'https://example.invalid/art.jpg',
      releaseYear: '2013',
    };
    const envelope = catalogTrackPlayEnvelope(track);
    expect(envelope.envelopeId).toBe('mb-single-abc');
    expect(envelope.title).toBe('Threatz');
    expect(envelope.album).toBe('Nostalgic 64');
    expect(envelope.artworkUrl).toBe('https://example.invalid/art.jpg');
    expect(envelope.url).toBe('');
  });
});
