import { describe, expect, it } from 'vitest';
import {
  forgetKnownGoodAlbumArt,
  getKnownGoodAlbumArt,
  pickLockerAlbumCover,
  preferStableLockerCoverUrl,
  rememberKnownGoodAlbumArt,
  rememberKnownGoodAlbumArtStable,
  resolveLockerAlbumArtSrc,
  resolveLockerTrackThumbArt,
  transferKnownGoodAlbumArt,
} from './albumArtCache';

describe('albumArtCache', () => {
  const key = 'Rebel::EsDeeKid';

  it('remembers and returns last-known-good art', () => {
    rememberKnownGoodAlbumArt(key, 'blob:abc');
    expect(getKnownGoodAlbumArt(key)).toBe('blob:abc');
    forgetKnownGoodAlbumArt(key);
    expect(getKnownGoodAlbumArt(key)).toBeUndefined();
  });

  it('transfers cache when album key changes', () => {
    rememberKnownGoodAlbumArt('old::artist', 'blob:old');
    transferKnownGoodAlbumArt('old::artist', 'new::artist');
    expect(getKnownGoodAlbumArt('old::artist')).toBeUndefined();
    expect(getKnownGoodAlbumArt('new::artist')).toBe('blob:old');
    forgetKnownGoodAlbumArt('new::artist');
  });

  it('prefers preview, then cached over vault blob, then vault', () => {
    rememberKnownGoodAlbumArt(key, 'blob:cached');
    expect(resolveLockerAlbumArtSrc(key, 'blob:vault', 'blob:preview', undefined)).toBe(
      'blob:preview',
    );
    expect(resolveLockerAlbumArtSrc(key, 'blob:vault', undefined, undefined)).toBe(
      'blob:cached',
    );
    expect(resolveLockerAlbumArtSrc(key, undefined, undefined, 'blob:vault')).toBe('blob:cached');
    expect(resolveLockerAlbumArtSrc(key, 'blob:vault', undefined, 'blob:vault')).toBe('blob:cached');
    forgetKnownGoodAlbumArt(key);
  });

  it('pickLockerAlbumCover skips last.fm branding and empty rows', () => {
    const tracks = [
      { albumArt: 'https://last.fm/images/default/album' },
      { albumArt: 'blob:good' },
    ];
    expect(pickLockerAlbumCover(tracks)).toBe('blob:good');
  });

  it('pickLockerAlbumCover prefers durable sibling art over stale blob on first row', () => {
    const tracks = [
      { albumArt: 'blob:dead-nee-nah' },
      { albumArt: 'https://is1-ssl.mzstatic.com/image/thumb/american-dream.jpg' },
    ];
    expect(pickLockerAlbumCover(tracks)).toBe(
      'https://is1-ssl.mzstatic.com/image/thumb/american-dream.jpg',
    );
  });

  it('pickLockerAlbumCover rejects lone wrong-catalog durable over sibling blob majority', () => {
    const westsidePainting =
      'https://is1-ssl.mzstatic.com/image/thumb/westside-gunn-pray-for-me.jpg';
    const tracks = [
      { albumArt: westsidePainting },
      { albumArt: 'blob:american-dream-1' },
      { albumArt: 'blob:american-dream-2' },
      { albumArt: 'blob:american-dream-3' },
    ];
    expect(pickLockerAlbumCover(tracks)).toBe('blob:american-dream-1');
  });

  it('pickLockerAlbumCover picks the same blob regardless of sibling order', () => {
    const a = 'blob:zzz-last-in-order';
    const b = 'blob:aaa-first-lexicographic';
    expect(
      pickLockerAlbumCover([{ albumArt: a }, { albumArt: b }]),
    ).toBe(b);
    expect(
      pickLockerAlbumCover([{ albumArt: b }, { albumArt: a }]),
    ).toBe(b);
  });

  it('preferStableLockerCoverUrl holds a live blob against a different remint', () => {
    const live = new Set(['blob:kept']);
    expect(preferStableLockerCoverUrl('blob:kept', 'blob:reminted', live)).toBe('blob:kept');
    expect(preferStableLockerCoverUrl('blob:kept', 'https://cdn.example/cover.jpg', live)).toBe(
      'https://cdn.example/cover.jpg',
    );
    expect(preferStableLockerCoverUrl('blob:dead', 'blob:fresh', new Set(['blob:fresh']))).toBe(
      'blob:fresh',
    );
  });

  it('rememberKnownGoodAlbumArtStable does not replace a still-live blob remint', () => {
    const albumKey = 'Stable::Artist';
    rememberKnownGoodAlbumArt(albumKey, 'blob:original');
    rememberKnownGoodAlbumArtStable(
      albumKey,
      'blob:reminted',
      [{ albumArt: 'blob:original' }, { albumArt: 'blob:reminted' }],
    );
    expect(getKnownGoodAlbumArt(albumKey)).toBe('blob:original');
    rememberKnownGoodAlbumArtStable(albumKey, 'blob:only-new', [{ albumArt: 'blob:only-new' }]);
    expect(getKnownGoodAlbumArt(albumKey)).toBe('blob:only-new');
    forgetKnownGoodAlbumArt(albumKey);
  });

  it('resolveLockerAlbumArtSrc drops session cache when vault sibling consensus disagrees', () => {
    rememberKnownGoodAlbumArt(key, 'https://example.com/westside-wrong.jpg');
    const vault = 'blob:american-dream-consensus';
    expect(resolveLockerAlbumArtSrc(key, vault, undefined, undefined)).toBe(vault);
    expect(getKnownGoodAlbumArt(key)).toBe(vault);
    forgetKnownGoodAlbumArt(key);
  });

  it('resolveLockerAlbumArtSrc prefers session cache over vault blob', () => {
    rememberKnownGoodAlbumArt(key, 'blob:cached');
    expect(resolveLockerAlbumArtSrc(key, 'blob:vault', undefined, undefined)).toBe(
      'blob:cached',
    );
    forgetKnownGoodAlbumArt(key);
  });

  it('resolveLockerTrackThumbArt backfills from album siblings and preview cache', () => {
    const key = 'Jesus Is King::Kanye West';
    rememberKnownGoodAlbumArt(key, 'blob:cached');
    const siblings = [{ albumArt: undefined }, { albumArt: 'blob:vault' }];
    expect(
      resolveLockerTrackThumbArt({ albumArt: undefined }, key, siblings, 'blob:preview', undefined),
    ).toBe('blob:preview');
    expect(
      resolveLockerTrackThumbArt({ albumArt: undefined }, key, siblings, undefined, undefined),
    ).toBe('blob:cached');
    expect(
      resolveLockerTrackThumbArt(
        { albumArt: undefined },
        key,
        [{ albumArt: undefined }],
        undefined,
        'blob:vault',
      ),
    ).toBe('blob:cached');
    forgetKnownGoodAlbumArt(key);
  });
});
