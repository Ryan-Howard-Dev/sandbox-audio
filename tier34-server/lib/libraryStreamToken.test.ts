import { describe, expect, it } from 'vitest';
import { mintLibraryStreamToken, verifyLibraryStreamToken } from './libraryStreamToken.js';

describe('libraryStreamToken', () => {
  it('round-trips a stream payload', () => {
    const token = mintLibraryStreamToken({
      kind: 'subsonic',
      baseUrl: 'http://192.168.1.5:4533',
      username: 'admin',
      password: 'secret',
      songId: 'song-1',
    });
    const payload = verifyLibraryStreamToken(token);
    expect(payload?.songId).toBe('song-1');
    expect(payload?.baseUrl).toBe('http://192.168.1.5:4533');
  });
});
