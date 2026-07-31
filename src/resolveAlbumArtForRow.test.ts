import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearMintedRowAlbumArtUrlsForTests,
  resolveAlbumArtForRow,
} from './lockerStorage';

describe('resolveAlbumArtForRow', () => {
  afterEach(() => {
    clearMintedRowAlbumArtUrlsForTests();
    vi.restoreAllMocks();
  });

  it('reuses the same object URL when locker art is unchanged', () => {
    const created: string[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      const url = `blob:row-art-${created.length}-${(blob as Blob).size}`;
      created.push(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/jpeg' });
    const row = { id: 'track-unchanged-art', albumArtBlob: blob };

    const first = resolveAlbumArtForRow(row);
    const second = resolveAlbumArtForRow(row);

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(created).toHaveLength(1);
  });

  it('still mints distinct object URLs for different row ids (no album-wide share)', () => {
    vi.spyOn(URL, 'createObjectURL').mockImplementation(
      (blob) => `blob:sib-${(blob as Blob).size}-${Math.random()}`,
    );
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' });
    const a = resolveAlbumArtForRow({ id: 'sib-a', albumArtBlob: blob });
    const b = resolveAlbumArtForRow({ id: 'sib-b', albumArtBlob: blob });

    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });
});
