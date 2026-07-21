import { describe, expect, it } from 'vitest';
import { isAllowedLibraryBaseUrl, normalizeLibraryBaseUrl } from './libraryUrlValidation.js';

describe('libraryUrlValidation', () => {
  it('allows private LAN hosts', () => {
    expect(isAllowedLibraryBaseUrl('http://192.168.1.42:4533')).toBe(true);
    expect(isAllowedLibraryBaseUrl('http://10.0.0.5:8096')).toBe(true);
  });

  it('normalizes base URL without trailing slash', () => {
    expect(normalizeLibraryBaseUrl('192.168.1.10:4533/')).toBe('http://192.168.1.10:4533');
  });

  it('rejects invalid schemes', () => {
    expect(isAllowedLibraryBaseUrl('ftp://192.168.1.1')).toBe(false);
  });
});
