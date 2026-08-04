import { useCallback, useEffect, useState } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  browserDecodeAudio,
  canMeasureDynamicRange,
  loadDynamicRange,
  measureTrackDynamicRange,
  saveDynamicRange,
  type DynamicRangeRecord,
} from '../trackDynamicRange';

export interface TrackDynamicRange {
  /** The reading, once this track has one. Null means nobody has asked yet. */
  record: DynamicRangeRecord | null;
  /** True while a decode is running — it takes seconds, so the caller must be able to say so. */
  measuring: boolean;
  /** Whether asking is possible at all: lossless, long enough, and not too long to decode. */
  available: boolean;
  /** Ask. Resolves to the reading, or null when the file could not be measured. */
  measure: () => Promise<DynamicRangeRecord | null>;
}

/**
 * The measured dynamic range of whatever is playing.
 *
 * Reads the stored value on every track change and never measures on its own. Decoding a track
 * materialises it as float PCM — around a hundred megabytes for five minutes of stereo — and doing
 * that silently whenever a lossless file started playing would be a memory spike a listener never
 * asked for. So the reading appears when it exists, and measuring is a thing somebody chooses.
 */
export function useTrackDynamicRange(
  envelope: MediaEnvelope | null | undefined,
  loadBytes: ((envelope: MediaEnvelope) => Promise<ArrayBuffer | null>) | undefined,
): TrackDynamicRange {
  const trackId = envelope?.envelopeId ?? '';
  const [record, setRecord] = useState<DynamicRangeRecord | null>(null);
  const [measuring, setMeasuring] = useState(false);

  useEffect(() => {
    // Cleared before the lookup, or the previous track's number sits under the new track's title
    // for as long as the read takes.
    setRecord(trackId ? loadDynamicRange(trackId) : null);
    setMeasuring(false);
  }, [trackId]);

  const available = canMeasureDynamicRange(envelope) && Boolean(loadBytes);

  const measure = useCallback(async (): Promise<DynamicRangeRecord | null> => {
    if (!envelope || !loadBytes || !canMeasureDynamicRange(envelope)) return null;
    const existing = loadDynamicRange(envelope.envelopeId);
    if (existing) {
      setRecord(existing);
      return existing;
    }
    const decode = browserDecodeAudio(envelope.sampleRateHz ?? undefined);
    if (!decode) return null;

    setMeasuring(true);
    try {
      const bytes = await loadBytes(envelope);
      if (!bytes) return null;
      const measured = await measureTrackDynamicRange(bytes, decode);
      if (!measured) return null;
      saveDynamicRange(envelope.envelopeId, measured);
      /*
       * Only adopt the reading if this is still the track being shown. A decode of a long file
       * outlives a skip, and writing the result to the screen afterwards would label whatever is
       * playing now with the range of something that finished a minute ago.
       */
      setRecord((current) => (envelope.envelopeId === trackId ? measured : current));
      return measured;
    } catch {
      return null;
    } finally {
      setMeasuring(false);
    }
  }, [envelope, loadBytes, trackId]);

  return { record, measuring, available, measure };
}
