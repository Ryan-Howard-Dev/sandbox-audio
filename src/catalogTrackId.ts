/**
 * iTunes / Apple Music catalog track ids — envelopes use `catalog-{id}` envelopeIds
 * while lookup APIs expect numeric track ids.
 */

/** Parse numeric track id from `12345`, `catalog-12345`, or `track-12345`. */
export function parseCatalogTrackId(id?: string | null): string | null {
  const trimmed = id?.trim() ?? '';
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  const match = trimmed.match(/^(?:catalog|track)-(\d+)$/i);
  return match?.[1] ?? null;
}

export function catalogTrackIdFromEnvelope(
  env: { sourceId?: string | null; envelopeId?: string | null },
): string | null {
  return parseCatalogTrackId(env.sourceId) ?? parseCatalogTrackId(env.envelopeId);
}

/** True when the value encodes an Apple catalog track id (numeric or prefixed). */
export function isCatalogTrackId(id?: string | null): boolean {
  return parseCatalogTrackId(id) != null;
}
