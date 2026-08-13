/**
 * Playback fidelity badge — lossless locker detection + stream policy label.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import type { FidelityPolicy } from './sandboxSettings';

const LOSSLESS_EXT = /\.(flac|wav|aiff|aif|alac|ape)(\?|#|$)/i;
const LOSSLESS_MIME = /flac|wav|aiff|alac|ape/i;

export type LosslessFormat = 'FLAC' | 'WAV' | 'ALAC' | 'AIFF' | 'APE' | null;

function losslessFormatFromHints(mime: string, url: string, title: string): LosslessFormat {
  const blob = `${mime} ${url} ${title}`.toLowerCase();
  if (blob.includes('flac')) return 'FLAC';
  if (blob.includes('alac')) return 'ALAC';
  if (blob.includes('aiff') || blob.includes('.aif')) return 'AIFF';
  if (blob.includes('wav')) return 'WAV';
  if (blob.includes('ape')) return 'APE';
  return null;
}

/**
 * True only when something about the source actually says lossless — mime type or extension.
 *
 * `provider === 'debrid'` used to return true on its own. Debrid sources are *often* lossless
 * rips, but "often" is not "is", and the badge was presenting the guess as a measurement. A
 * debrid URL that names a lossless format still matches on that format, which is the real signal.
 */
export function isLosslessEnvelope(envelope: MediaEnvelope | null | undefined): boolean {
  if (!envelope) return false;

  const mime = (envelope.mimeType ?? '').toLowerCase();
  const url = (envelope.url ?? '').toLowerCase();
  const title = (envelope.title ?? '').toLowerCase();

  if (LOSSLESS_MIME.test(mime)) return true;
  if (LOSSLESS_EXT.test(url) || LOSSLESS_EXT.test(title)) return true;
  return false;
}

export function losslessFormatForEnvelope(
  envelope: MediaEnvelope | null | undefined,
): LosslessFormat {
  if (!envelope || !isLosslessEnvelope(envelope)) return null;
  return losslessFormatFromHints(
    envelope.mimeType ?? '',
    envelope.url ?? '',
    envelope.title ?? '',
  );
}

export function fidelityPolicyBitDepthLabel(
  policy: FidelityPolicy,
  t: (key: string) => string,
): string {
  switch (policy) {
    case 'HIGH':
      return t('player.menu.bitDepthHigh');
    case 'LOSSLESS':
      return t('player.menu.bitDepthLossless');
    default:
      return t('player.menu.bitDepthStandard');
  }
}

export function losslessBadgeLabel(
  envelope: MediaEnvelope,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const format = losslessFormatForEnvelope(envelope);
  if (format === 'FLAC' || format === 'ALAC') {
    return t('player.fidelity.losslessFormat', { format });
  }
  if (format) {
    return t('player.fidelity.losslessFormat', { format });
  }
  return t('player.fidelity.losslessDefault');
}

/**
 * What is playing — never what the user asked for.
 *
 * The lossy branch used to append `fidelityPolicyBitDepthLabel`, which describes the *configured
 * fidelity policy*: "24-bit · lossless" for the LOSSLESS setting, regardless of the stream. So a
 * 64 kbps LibriVox MP3 rendered "MOBILE · 24-BIT · LOSSLESS" on the now-playing screen. A
 * preference is not a property of the audio, and stating it as one is the one thing an app that
 * sells itself on audio honesty cannot do.
 *
 * Now: say the format when the source actually identifies one, otherwise say only where the
 * stream came from. The policy label still exists for the settings menu, where it is a true
 * statement about a setting.
 */
/**
 * Append the measured range, if there is one.
 *
 * "DR12" rather than a word, because the number is the thing a listener comparing two pressings
 * wants and the word is an interpretation. dynamicRangeVerdict exists for anywhere that wants to
 * colour it; the badge states the measurement.
 */
function withDynamicRange(label: string | null, dr: number | null | undefined): string | null {
  if (!label) return label;
  if (dr === null || dr === undefined || !Number.isFinite(dr) || dr < 0) return label;
  return `${label} · DR${Math.round(dr)}`;
}

export function resolvePlaybackFidelityLabel(
  envelope: MediaEnvelope | null | undefined,
  options: {
    streamLabel?: string | null;
    t: (key: string, params?: Record<string, string | number>) => string;
    policy?: FidelityPolicy;
    /**
     * Measured dynamic range, when this track has been measured.
     *
     * Appended rather than substituted, because it answers a different question from the rest of
     * the badge. Depth, rate and codec describe the container: whether anything was thrown away in
     * encoding. DR describes the master: whether anything was squeezed out before encoding ever
     * happened. A 24-bit file crushed to DR5 is losslessly storing something that was already
     * flattened, and until now nothing on this screen could say so.
     *
     * Only ever shown when it was actually measured. See trackDynamicRange.ts — nothing here
     * estimates it, and an unmeasured track simply says nothing about its range.
     */
    dynamicRange?: number | null;
  },
): string | null {
  if (!envelope) return null;

  if (isLosslessEnvelope(envelope)) {
    /*
     * Depth and rate beat the word "lossless" when the file states them. "FLAC 24-bit 96 kHz" says
     * what was captured; "lossless" only says nothing was thrown away, which is true of a 16-bit
     * CD rip and a studio master alike. These come from STREAMINFO, so they are the encoder's own
     * figures — the badge is still only ever repeating what the file says about itself.
     */
    const depth = Math.round(envelope.bitsPerSample ?? 0);
    const rateHz = Math.round(envelope.sampleRateHz ?? 0);
    if (depth > 0 && rateHz > 0) {
      const format = losslessFormatForEnvelope(envelope) ?? 'Lossless';
      const rate =
        rateHz % 1000 === 0 ? `${rateHz / 1000} kHz` : `${(rateHz / 1000).toFixed(1)} kHz`;
      return withDynamicRange(`${format} ${depth}-bit ${rate}`, options.dynamicRange);
    }
    return withDynamicRange(losslessBadgeLabel(envelope, options.t), options.dynamicRange);
  }

  /*
   * A measured bitrate outranks the transport.
   *
   * The badge sits under the title where a listener looks for how good this sounds, and it was
   * answering a different question: "MOBILE" says which code path fetched the bytes, which is
   * true and useless — of course it is a phone. Bitrate is a property of the audio, so it belongs
   * here whenever the source reports one, and the transport is what is left to say when nothing
   * about the stream is known.
   */
  const bitrate = Math.round(envelope.bitrateKbps ?? 0);
  if (bitrate > 0) {
    const format = lossyFormatForEnvelope(envelope);
    return format ? `${format} · ${bitrate} kbps` : `${bitrate} kbps`;
  }

  /*
   * A transport word is not an answer to the question this badge asks.
   *
   * transportLabel returns LOCAL, HTTP, PROXY or DEBRID: which pipe the bytes came down. Under the
   * title, where a listener is looking for how good this sounds, "HTTP" reads as though it were a
   * format. It is the same objection already recorded above about "MOBILE" -- true, and useless.
   *
   * So when nothing is known about the audio, the badge says nothing. Anything else a caller
   * passes is still shown, because a provider's own quality wording does answer the question.
   */
  const label = options.streamLabel?.trim();
  if (!label || TRANSPORT_ONLY_LABELS.has(label.toUpperCase())) return null;
  return label;
}

/** Plumbing words that describe the connection rather than the audio. */
const TRANSPORT_ONLY_LABELS = new Set(['LOCAL', 'HTTP', 'HTTPS', 'PROXY', 'DEBRID', 'MOBILE']);

const LOSSY_FORMAT_HINTS: Array<[RegExp, string]> = [
  [/opus/i, 'OPUS'],
  [/(^|[^a-z])m4a|aac|mp4a/i, 'AAC'],
  [/vorbis|\.ogg(\?|#|$)/i, 'OGG'],
  [/mpeg|mp3/i, 'MP3'],
];

/** Codec name when the mime type or URL actually says one — never a guess from the provider. */
export function lossyFormatForEnvelope(envelope: MediaEnvelope | null | undefined): string | null {
  if (!envelope) return null;
  const blob = `${envelope.mimeType ?? ''} ${envelope.url ?? ''}`;
  if (!blob.trim()) return null;
  for (const [pattern, label] of LOSSY_FORMAT_HINTS) {
    if (pattern.test(blob)) return label;
  }
  return null;
}
