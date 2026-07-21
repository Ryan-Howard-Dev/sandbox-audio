import { describe, expect, it } from 'vitest';
import { isLastFmBrandingCoverUrl } from './displaySanitize';

describe('isLastFmBrandingCoverUrl', () => {
  it('rejects the classic last.fm red logo hash', () => {
    expect(
      isLastFmBrandingCoverUrl(
        'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png',
      ),
    ).toBe(true);
  });

  it('rejects default image paths', () => {
    expect(
      isLastFmBrandingCoverUrl('https://www.lastfm.com/images/default_album.png'),
    ).toBe(true);
  });

  it('rejects any last.fm CDN host', () => {
    expect(
      isLastFmBrandingCoverUrl(
        'https://lastfm.freetls.fastly.net/i/u/640x640/abc123realcover.png',
      ),
    ).toBe(true);
  });

  it('allows real non-branding https covers', () => {
    expect(
      isLastFmBrandingCoverUrl(
        'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/cover.jpg/600x600bb.jpg',
      ),
    ).toBe(false);
  });
});
