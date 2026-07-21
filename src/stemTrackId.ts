import type { MediaEnvelope } from './sandboxLayer1';

/** Resolve tier34 stems manifest key from a playing envelope. */
export function resolveStemTrackId(envelope: MediaEnvelope | null | undefined): string | null {
  if (!envelope) return null;
  const id = envelope.envelopeId?.trim();
  if (!id) return null;
  if (id.startsWith('local-')) return id.slice('local-'.length);
  if (id.startsWith('locker-')) return id;
  const source = envelope.sourceId?.trim();
  if (source && /^[a-f0-9]{64}$/i.test(source)) return source.toLowerCase();
  return id;
}
