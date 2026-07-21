import { describe, expect, it } from 'vitest';
import {
  catalogTrackIdFromEnvelope,
  isCatalogTrackId,
  parseCatalogTrackId,
} from './catalogTrackId';

describe('parseCatalogTrackId', () => {
  it('accepts bare numeric ids', () => {
    expect(parseCatalogTrackId('1843895742')).toBe('1843895742');
  });

  it('extracts id from catalog- and track- prefixes', () => {
    expect(parseCatalogTrackId('catalog-1843895742')).toBe('1843895742');
    expect(parseCatalogTrackId('track-99')).toBe('99');
  });

  it('rejects non-catalog ids', () => {
    expect(parseCatalogTrackId('local-abc')).toBeNull();
    expect(parseCatalogTrackId('')).toBeNull();
  });
});

describe('catalogTrackIdFromEnvelope', () => {
  it('prefers sourceId then envelopeId', () => {
    expect(
      catalogTrackIdFromEnvelope({
        sourceId: 'catalog-42',
        envelopeId: 'catalog-99',
      }),
    ).toBe('42');
    expect(
      catalogTrackIdFromEnvelope({
        sourceId: '',
        envelopeId: 'catalog-99',
      }),
    ).toBe('99');
  });
});

describe('isCatalogTrackId', () => {
  it('matches prefixed and numeric ids', () => {
    expect(isCatalogTrackId('catalog-1')).toBe(true);
    expect(isCatalogTrackId('1')).toBe(true);
    expect(isCatalogTrackId('youtube-abc')).toBe(false);
  });
});
