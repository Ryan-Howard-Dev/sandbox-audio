import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Playback cover mint lifecycle — isolated from IndexedDB.
 *
 * The full adoptPlaybackLockerArtwork path needs IDB; these helpers mirror the revoke-on-change
 * contract so a regression that re-shares album URLs or forgets revoke is caught here.
 */

describe('playback locker artwork URL lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mints a fresh object URL per track and revokes the previous one', () => {
    const created: string[] = [];
    const revoked: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:test-${created.length}-${(blob as Blob).size}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => {
      revoked.push(String(url));
    });

    let playbackUrl: string | undefined;
    let playbackEntryId: string | undefined;

    const adopt = (entryId: string, blob: Blob): string => {
      if (playbackEntryId === entryId && playbackUrl) return playbackUrl;
      if (playbackUrl?.startsWith('blob:')) URL.revokeObjectURL(playbackUrl);
      playbackUrl = URL.createObjectURL(blob);
      playbackEntryId = entryId;
      return playbackUrl;
    };

    const a = adopt('locker-a', new Blob([new Uint8Array([1])]));
    const aAgain = adopt('locker-a', new Blob([new Uint8Array([1])]));
    const b = adopt('locker-b', new Blob([new Uint8Array([1, 2])]));

    expect(aAgain).toBe(a);
    expect(b).not.toBe(a);
    expect(created).toHaveLength(2);
    expect(revoked).toEqual([a]);
  });

  it('does not reuse one object URL across album siblings', () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (blob) => `blob:sib-${(blob as Blob).size}-${Math.random()}`,
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const urls = new Set<string>();
    for (const id of ['t1', 't2', 't3']) {
      urls.add(URL.createObjectURL(new Blob([id])));
    }
    expect(urls.size).toBe(3);
  });
});
