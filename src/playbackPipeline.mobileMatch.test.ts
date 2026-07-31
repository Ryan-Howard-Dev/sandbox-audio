import { describe, expect, it, vi } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';

vi.mock('./catalogDirect', () => ({
  canResolveFullStreams: vi.fn(() => true),
  allowCatalogPreviewPlayback: vi.fn(() => false),
  catalogPlayUrlFromPreview: vi.fn((url?: string | null) => url?.trim() ?? ''),
}));

vi.mock('./addons/searchProviders', () => ({
  searchBuiltinPackAddons: vi.fn(async () => []),
  searchDebrid: vi.fn(async () => []),
  searchProxy: vi.fn(async () => []),
  searchUserManifestAddons: vi.fn(async () => []),
}));

vi.mock('./addonStorage', () => ({
  getEnabledAddons: vi.fn(() => []),
}));

vi.mock('./tier34/client', () => ({
  getTier34BaseUrl: vi.fn(() => 'http://127.0.0.1:3001'),
  isTier34ReachableCached: vi.fn(() => true),
  tier34DhtResolve: vi.fn(async () => null),
}));

import { resolvedStreamMatchesCatalog } from './playbackPipeline';

/*
 * R-001. Mobile resolves were accepted without any identity check, so tapping one song could play
 * another. They cannot be held to the tier thresholds either — a yt-dlp hit reports a decorated
 * title and often the uploader as the artist — so these cover both directions: a wrong track is
 * rejected, and the messy-but-correct hits a real resolver returns still play.
 */

const catalog = (over: Partial<MediaEnvelope> = {}): MediaEnvelope => ({
  envelopeId: 'catalog-1',
  title: 'Walkin',
  artist: 'Denzel Curry',
  url: '',
  durationSeconds: 220,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-1',
  ...over,
});

const mobile = (over: Partial<MediaEnvelope> = {}): MediaEnvelope => ({
  envelopeId: 'catalog-1',
  title: 'Walkin',
  artist: 'Denzel Curry',
  url: 'https://rr3---sn-abc.googlevideo.com/videoplayback?expire=9999999999',
  durationSeconds: 220,
  provider: 'https',
  transport: 'element-src',
  sourceId: 'track-1',
  resolutionSource: 'mobile',
  ...over,
});

describe('resolvedStreamMatchesCatalog — mobile resolves', () => {
  it('accepts a decorated title that contains the catalog title', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog(),
        mobile({ title: 'Denzel Curry - Walkin (Official Music Video)' }),
      ),
    ).toBe(true);
  });

  /* Re-upload channels carry the correct audio under a channel name. */
  it('accepts a generic uploader as the artist', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog(),
        mobile({ title: 'Walkin', artist: 'YouTube' }),
      ),
    ).toBe(true);
  });

  /* The common shape of a wrong hit: an hour-long mix or compilation. */
  it('rejects a stream far longer than the catalog track', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog(),
        mobile({ title: 'Best Rap Mix 2022', durationSeconds: 3_600 }),
      ),
    ).toBe(false);
  });

  it('rejects a snippet far shorter than the catalog track', () => {
    expect(resolvedStreamMatchesCatalog(catalog(), mobile({ durationSeconds: 30 }))).toBe(false);
  });

  it('rejects a different song of a similar length', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog(),
        mobile({ title: 'Ultimate', artist: 'Denzel Curry', durationSeconds: 215 }),
      ),
    ).toBe(false);
  });

  it('rejects a specific artist that plainly disagrees', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog(),
        mobile({ title: 'Walkin', artist: 'Taylor Swift' }),
      ),
    ).toBe(false);
  });

  /*
   * When a resolver reports no metadata of its own, envelopeFromResolved falls back to the
   * catalog's, so this compares the envelope against itself. It must not invent a mismatch.
   */
  it('accepts a resolve that carried no metadata of its own', () => {
    expect(resolvedStreamMatchesCatalog(catalog(), mobile())).toBe(true);
  });

  it('accepts when neither side reports a duration', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog({ durationSeconds: 0 }),
        mobile({ durationSeconds: 0, title: 'Walkin (Official Video)' }),
      ),
    ).toBe(true);
  });

  /* Short catalog durations are unreliable, so the ratio rule stays out of it. */
  it('does not apply the duration rule to very short catalog entries', () => {
    expect(
      resolvedStreamMatchesCatalog(
        catalog({ durationSeconds: 30 }),
        mobile({ durationSeconds: 200 }),
      ),
    ).toBe(true);
  });

  it('still rejects a resolve with no url at all', () => {
    expect(resolvedStreamMatchesCatalog(catalog(), mobile({ url: '' }))).toBe(false);
  });
});
