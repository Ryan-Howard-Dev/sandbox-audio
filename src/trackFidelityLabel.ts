/**
 * Playback fidelity badge — lossless locker detection + stream policy label.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { loadFidelityPolicy, type FidelityPolicy } from './sandboxSettings';

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

/** True when the active envelope is a lossless locker or debrid source. */
export function isLosslessEnvelope(envelope: MediaEnvelope | null | undefined): boolean {
  if (!envelope) return false;
  if (envelope.provider === 'debrid') return true;

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

export function resolvePlaybackFidelityLabel(
  envelope: MediaEnvelope | null | undefined,
  options: {
    streamLabel?: string | null;
    t: (key: string, params?: Record<string, string | number>) => string;
    policy?: FidelityPolicy;
  },
): string | null {
  if (!envelope) return null;

  if (isLosslessEnvelope(envelope)) {
    return losslessBadgeLabel(envelope, options.t);
  }

  const policyLabel = fidelityPolicyBitDepthLabel(
    options.policy ?? loadFidelityPolicy(),
    options.t,
  );
  if (options.streamLabel) {
    return `${options.streamLabel} · ${policyLabel}`;
  }
  return policyLabel;
}
