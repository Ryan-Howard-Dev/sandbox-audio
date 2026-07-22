import { describe, expect, it } from 'vitest';
import {
  AUDIOBOOK_CATALOG_ENVELOPE_PREFIX,
  isAudiobookCatalogEnvelopeId,
} from './audiobookCatalogIds';

describe('audiobookCatalogIds', () => {
  it('detects catalog envelope ids without loading scrape providers', () => {
    expect(AUDIOBOOK_CATALOG_ENVELOPE_PREFIX).toBe('audiobook-catalog:');
    expect(isAudiobookCatalogEnvelopeId('audiobook-catalog:librivox:253:124135')).toBe(true);
    expect(isAudiobookCatalogEnvelopeId('audiobook:123')).toBe(false);
    expect(isAudiobookCatalogEnvelopeId(null)).toBe(false);
  });
});
