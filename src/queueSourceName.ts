/**
 * Names the queue for the "Playing from" header on the player.
 *
 * The app already builds a full sentence for the footer ("Playing from radio · Blue Moon"). Under a
 * "Playing from" eyebrow that sentence says the words twice, so the header needs the name on its
 * own. Only a mix/radio session actually knows a name; a queue seeded from a station is described
 * by the station sentence and has nothing better to offer, which is why this returns null there and
 * lets the caller fall back rather than inventing a label.
 */

import type { MixRadioSession } from './playerMixRadio';

export interface QueueSourceName {
  /** i18n key under player.queueSheet — resolved by the caller so this module stays pure. */
  key: string;
  params?: Record<string, string>;
}

export function resolveQueueSourceName(
  session: MixRadioSession | null | undefined,
): QueueSourceName | null {
  if (!session) return null;

  const title = session.seedTitle?.trim() ?? '';
  const artist = session.seedArtist?.trim() ?? '';

  if (session.kind === 'discovery-station') {
    return { key: 'sourceDiscoveryStation' };
  }
  if (session.kind === 'discovery-mfy') {
    return title ? { key: 'sourceDiscoveryMix', params: { title } } : null;
  }
  if (session.kind === 'mix') {
    return artist ? { key: 'sourceArtistMix', params: { artist } } : null;
  }
  return title ? { key: 'sourceTrackRadio', params: { title } } : null;
}
