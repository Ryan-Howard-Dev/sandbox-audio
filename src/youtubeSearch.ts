/**
 * YouTube search results as playable catalog tracks.
 *
 * The iTunes catalog doesn't carry mixtapes, rare singles, demos, bootlegs, or DJ sets —
 * YouTube does, and the app already resolves/plays audio from YouTube via yt-dlp. This
 * surfaces `ytsearch` hits in the search box as normal tappable tracks. Keyless (uses the
 * on-device yt-dlp), Android-only; on web it returns nothing and callers degrade gracefully.
 */

import type { CatalogTrack } from './searchCatalog';
import type { MediaEnvelope } from './sandboxLayer1';
import { searchYtDlpMobile, type YtDlpMobileSearchHit } from './ytDlpMobile';
import { WEB_SUPPLEMENT_ID_PREFIX } from './webSupplementId';

/** i.ytimg.com thumbnail for a YouTube video id (no API key needed). */
function youtubeThumb(watchUrl: string): string | undefined {
  const m = watchUrl.match(/(?:v=|youtu\.be\/|\/embed\/)([\w-]{11})/);
  return m?.[1] ? `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg` : undefined;
}

function hitToCatalogTrack(hit: YtDlpMobileSearchHit): CatalogTrack {
  const artist = hit.artist?.trim() || 'YouTube';
  const title = hit.title?.trim();
  const artworkUrl = youtubeThumb(hit.watchUrl);
  // Same envelope shape as an iTunes catalog track (provider 'https', resolved via yt-dlp on
  // Android) but seeded with the YouTube watch URL so resolution can use it directly.
  const envelope: MediaEnvelope = {
    envelopeId: `${WEB_SUPPLEMENT_ID_PREFIX}${hit.id}`,
    title,
    artist,
    url: hit.watchUrl,
    durationSeconds: hit.durationSeconds,
    provider: 'https',
    transport: 'element-src',
    sourceId: hit.id,
    artworkUrl,
  };
  return {
    kind: 'track',
    id: `${WEB_SUPPLEMENT_ID_PREFIX}${hit.id}`,
    title,
    artist,
    artworkUrl,
    durationSeconds: hit.durationSeconds,
    envelope,
  };
}

/** Search YouTube and return playable catalog tracks (empty on web / when unavailable). */
export async function searchYouTubeTracks(query: string, limit = 15): Promise<CatalogTrack[]> {
  const hits = await searchYtDlpMobile(query, limit);
  return hits.map(hitToCatalogTrack);
}
