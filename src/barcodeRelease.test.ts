import { describe, expect, it, vi } from 'vitest';
import { lookupBarcode } from './barcodeRelease';

const MB_RESPONSE = {
  releases: [
    {
      id: 'mbid-1',
      title: 'The Dark Side of the Moon',
      date: '1973-03-01',
      'artist-credit': [{ name: 'Pink Floyd', joinphrase: '' }],
      media: [{ format: '12" Vinyl', 'track-count': 10 }],
    },
  ],
};

function deps(payload: unknown, spy = vi.fn()) {
  return {
    fetchJson: vi.fn(async (url: string, headers: Record<string, string>) => {
      spy(url, headers);
      return payload;
    }),
  };
}

describe('reading a sleeve', () => {
  it('resolves a barcode to a release', async () => {
    const result = await lookupBarcode('5099902988665', deps(MB_RESPONSE));
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.release.title).toBe('The Dark Side of the Moon');
    expect(result.release.artist).toBe('Pink Floyd');
    expect(result.release.year).toBe(1973);
    expect(result.release.trackCount).toBe(10);
    expect(result.release.media).toBe('12" Vinyl');
    expect(result.release.barcode).toBe('5099902988665');
  });

  it('reassembles a multi-artist credit the way the sleeve prints it', async () => {
    // artist-credit is an array precisely because one release can be credited to several people,
    // and the joinphrase carries the " & " between them.
    const payload = {
      releases: [
        {
          id: 'mbid-2',
          title: 'Watch the Throne',
          'artist-credit': [
            { name: 'Jay-Z', joinphrase: ' & ' },
            { name: 'Kanye West', joinphrase: '' },
          ],
        },
      ],
    };
    const result = await lookupBarcode('012345678905', deps(payload));
    expect(result.status === 'found' && result.release.artist).toBe('Jay-Z & Kanye West');
  });

  it('sends the digits only, whatever separators the scan carried', async () => {
    const spy = vi.fn();
    await lookupBarcode('5 099902 988665', deps(MB_RESPONSE, spy));
    expect(spy.mock.calls[0]![0]).toContain('barcode:5099902988665');
  });

  it('identifies itself to the catalogue', async () => {
    // MusicBrainz asks for a user agent and throttles anonymous clients that do not send one.
    const spy = vi.fn();
    await lookupBarcode('5099902988665', deps(MB_RESPONSE, spy));
    expect(spy.mock.calls[0]![1]['User-Agent']).toMatch(/SandboxMusic/);
  });
});

describe('the three ways it can fail, kept apart', () => {
  /*
   * Retype it, enter it by hand, or try again on wifi. Those are three different instructions to
   * somebody stood holding a record, and collapsing them into one null tells them none of it.
   */
  it('calls a mis-scan invalid without asking the catalogue', async () => {
    const d = deps(MB_RESPONSE);
    expect((await lookupBarcode('1234', d)).status).toBe('invalid');
    expect(d.fetchJson).not.toHaveBeenCalled();
  });

  it('calls a well-formed number the catalogue does not know unknown', async () => {
    expect((await lookupBarcode('5099902988665', deps({ releases: [] }))).status).toBe('unknown');
  });

  it('calls a network failure unavailable, not unknown', async () => {
    const d = {
      fetchJson: vi.fn(async () => {
        throw new Error('offline');
      }),
    };
    expect((await lookupBarcode('5099902988665', d)).status).toBe('unavailable');
  });

  it('treats a malformed row as unknown rather than inventing a release', async () => {
    expect(
      (await lookupBarcode('5099902988665', deps({ releases: [{ id: '', title: '' }] }))).status,
    ).toBe('unknown');
    expect((await lookupBarcode('5099902988665', deps({}))).status).toBe('unknown');
  });

  it('survives a release with no date, media or credit', async () => {
    const result = await lookupBarcode(
      '5099902988665',
      deps({ releases: [{ id: 'm', title: 'Untitled' }] }),
    );
    expect(result.status).toBe('found');
    if (result.status !== 'found') return;
    expect(result.release.year).toBeUndefined();
    expect(result.release.trackCount).toBeUndefined();
    expect(result.release.artist).toBe('');
  });
});
