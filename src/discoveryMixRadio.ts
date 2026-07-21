/**
 * Made For You ↔ mix-radio bridge — re-exports playerMixRadio + sonicLockerRadio wiring.
 */

export {
  buildSessionContinuationCandidates,
  discoveryMixRadioSession,
  isDiscoveryMixRadioSession,
  orderMixRadioTracks,
  prepareDiscoveryMixQueue,
  type MixRadioSession,
} from './playerMixRadio';

import type { DiscoveryMix, DiscoveryMixKind } from './discoveryMixes';
import {
  composeDiscoveryMixTracks,
  resolveDiscoveryMixFromCacheSync,
} from './discoveryMixes';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  buildSessionContinuationCandidates,
  orderMixRadioTracks,
  type MixRadioSession,
} from './playerMixRadio';
import { getLockerEntriesSnapshot } from './lockerStorage';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import { buildSonicLockerContinuation } from './sonicLockerRadio';

function lockerFallbackPool(limit = 80): MediaEnvelope[] {
  return (getLockerEntriesSnapshot() ?? [])
    .filter((e) => e.url?.trim())
    .slice(0, limit)
    .map(lockerEntryToEnvelope);
}

function genreForDiscoveryMix(
  kind: DiscoveryMixKind,
  id: string,
  mix: DiscoveryMix | null,
): string | null {
  if (kind === 'my-mix') {
    const slotMatch = /^my-mix-(\d+)$/.exec(id);
    if (slotMatch) {
      const genreFromTitle = mix?.title?.replace(/^My\s+/i, '').replace(/\s+Mix$/i, '');
      if (genreFromTitle?.trim()) return genreFromTitle.trim();
    }
  }
  if (kind === 'weekly-discover' && mix?.subtitle) {
    const part = mix.subtitle.split('·')[0]?.trim();
    if (part) return part;
  }
  return null;
}

/** Sync continuation picks when an MFY mix/radio queue ends. */
export function buildDiscoveryMixContinuation(
  session: MixRadioSession,
  seed: MediaEnvelope,
  exclude: Set<string>,
  count = 3,
): MediaEnvelope[] {
  if (session.kind !== 'discovery-mfy' || !session.discoveryMixKind || !session.discoveryMixId) {
    return buildSessionContinuationCandidates(seed, exclude, count);
  }

  const cached = resolveDiscoveryMixFromCacheSync(
    session.discoveryMixKind,
    session.discoveryMixId,
  );
  const cachedPool =
    cached?.tracks.filter(
      (t) => t.url?.trim() && !exclude.has(t.envelopeId) && t.envelopeId !== seed.envelopeId,
    ) ?? [];

  let picks = orderMixRadioTracks([seed, ...cachedPool], seed).slice(1, 1 + count);
  if (picks.length >= count) return picks;

  const genre = genreForDiscoveryMix(session.discoveryMixKind, session.discoveryMixId, cached);

  const sonicPicks = buildSonicLockerContinuation(exclude, count - picks.length, seed, {
    genreFilter: genre || undefined,
  }).map((p) => p.envelope);
  picks = [...picks, ...sonicPicks];
  if (picks.length >= count) return picks.slice(0, count);

  const lockerPool = lockerFallbackPool();
  const fresh = composeDiscoveryMixTracks(
    lockerPool.filter((t) => !exclude.has(t.envelopeId)),
    count - picks.length,
    { genreFilter: genre || undefined },
  ).filter((t) => !exclude.has(t.envelopeId));

  picks = [...picks, ...fresh];
  if (picks.length >= count) return picks.slice(0, count);

  const fallback = buildSessionContinuationCandidates(seed, exclude, count - picks.length);
  return [...picks, ...fallback].slice(0, count);
}
