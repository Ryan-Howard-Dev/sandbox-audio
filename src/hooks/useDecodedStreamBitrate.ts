import { useEffect, useState } from 'react';
import { getNativeExoPlaybackStatus } from '../androidNativePlayback';
import { isAndroid } from '../platformEnv';

/**
 * The bitrate of the stream actually being decoded, when the envelope does not carry one.
 *
 * Locker tracks have their bitrate measured at import and stored on the row, so the badge under the
 * title can say "AAC · 156 kbps". Nothing measures a stream, so its envelope has no figure and the
 * badge fell back to naming the transport instead — "HTTP", which describes how the bytes arrived
 * and says nothing whatsoever about how it sounds. That is the one question the badge exists to
 * answer.
 *
 * The decoder has the number the whole time. This asks it once per track rather than polling: a
 * bitrate does not change mid-stream, and a value that never changes has no business being read
 * sixty times a second.
 */
export function useDecodedStreamBitrate(input: {
  /** Identity of what is playing — a new one means a new figure to fetch. */
  envelopeId: string | null | undefined;
  /** Skip entirely when the envelope already states a bitrate; a measured file outranks this. */
  enabled: boolean;
}): number | null {
  const { envelopeId, enabled } = input;
  const [bitrate, setBitrate] = useState<number | null>(null);

  useEffect(() => {
    /*
     * Cleared on every change of track, not merely on a successful read. Holding the previous
     * track's bitrate while the next one is being asked about would put a confident and wrong
     * number under a different title, which is worse than the transport name it replaces.
     */
    setBitrate(null);
    if (!enabled || !isAndroid() || !envelopeId) return;

    let cancelled = false;
    /*
     * A short delay, then one read. The format is not selected the instant play is called, and
     * asking too early reliably returns nothing at all — which would leave the badge on "HTTP"
     * for the whole track despite the answer arriving a moment later.
     */
    const timer = window.setTimeout(() => {
      void getNativeExoPlaybackStatus()
        .then((status) => {
          if (cancelled) return;
          const kbps = Math.round(status?.bitrateKbps ?? 0);
          if (kbps > 0) setBitrate(kbps);
        })
        .catch(() => {
          /* No figure is the same outcome as before this existed: the transport name. */
        });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [envelopeId, enabled]);

  return bitrate;
}
