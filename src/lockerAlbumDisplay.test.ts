import { describe, expect, it } from 'vitest';
import { formatAlbumDisplayName, parseAlbumFolderName, isTitleFragmentArtistName, isUsableArtistName } from './lockerStorage';

describe('album display names', () => {
  it('shows full album title when name contains &', () => {
    const display = formatAlbumDisplayName('Mr. Morale & the Big Steppers');
    expect(display).toContain('Mr. Morale');
    expect(display).toContain('Big Steppers');
    expect(display).not.toBe('& the Big Steppers');
  });

  it('does not strip honorific prefixes from display names', () => {
    expect(formatAlbumDisplayName('Mr. Morale & the Big Steppers')).not.toBe(
      '& the Big Steppers',
    );
  });

  it('still title-cases stored album names', () => {
    expect(formatAlbumDisplayName('damn.')).toBe('Damn.');
  });

  it('strips tech tokens from display without removing title words', () => {
    const display = formatAlbumDisplayName('Mr. Morale & the Big Steppers [2022] FLAC');
    expect(display).toContain('Mr. Morale');
    expect(display).toContain('Big Steppers');
    expect(display).not.toMatch(/flac/i);
  });
});

describe('parseAlbumFolderName', () => {
  it('does not split album titles that continue after &', () => {
    const parsed = parseAlbumFolderName('Mr. Morale & the Big Steppers');
    expect(parsed.album).toBe('Mr. Morale & the Big Steppers');
    expect(parsed.artist).toBeUndefined();
  });

  it('still splits Artist - Album folder names', () => {
    const parsed = parseAlbumFolderName('Kendrick Lamar - DAMN.');
    expect(parsed.artist).toBe('Kendrick Lamar');
    expect(parsed.album).toBe('DAMN.');
  });

  it('does not treat KING OF THE… album title prefix as artist', () => {
    const parsed = parseAlbumFolderName('KING OF THE MISCHIEVOUS SOUTH VOL. 2');
    expect(parsed.album).toBe('KING OF THE MISCHIEVOUS SOUTH VOL. 2');
    expect(parsed.artist).toBeUndefined();
    expect(isTitleFragmentArtistName('King Of', { title: 'KING OF THE MISCHIEVOUS SOUTH VOL. 2' })).toBe(
      true,
    );
    expect(isUsableArtistName('King Of')).toBe(false);
  });
});
