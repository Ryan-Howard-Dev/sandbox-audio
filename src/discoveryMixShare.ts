/**
 * Mixes are generated in memory and never hit playlist storage, but the share/export helpers
 * all speak StoredPlaylist. This adapts one to the other so a mix can reuse
 * `shareOrDownloadPlaylist` without first being saved as a playlist.
 */

import type { DiscoveryMix } from './discoveryMixes';
import type { StoredPlaylist } from './playlistStorage';

export function discoveryMixAsPlaylist(mix: DiscoveryMix): StoredPlaylist {
  return {
    // Prefixed so an exported mix can never collide with a real stored playlist id.
    id: `discovery-mix-${mix.id}`,
    name: mix.title,
    description: mix.subtitle,
    tracks: mix.tracks,
    updatedAt: mix.generatedAt,
  };
}
