/**
 * Lightweight audiobook catalog id helpers — safe for shell/playback paths.
 * Keep this free of scrape providers and heavy catalog imports.
 */

export const AUDIOBOOK_CATALOG_ENVELOPE_PREFIX = 'audiobook-catalog:';

export function isAudiobookCatalogEnvelopeId(envelopeId: string | null | undefined): boolean {
  return (envelopeId?.trim() ?? '').startsWith(AUDIOBOOK_CATALOG_ENVELOPE_PREFIX);
}
