/**
 * YouTube search hits must carry the id prefix the rest of the search pipeline looks for.
 *
 * They were built as `yt-<id>` while six places ask `startsWith('youtube-')` to decide whether a
 * row is a web supplement. The consequential one is applyWebSupplementToUnified, which collects
 * the web rows out of the merged catalog by that prefix: no matches, so every yt-dlp hit was
 * merged into the catalog and then dropped before anything rendered. Since yt-dlp is the only
 * source for anything iTunes does not carry, that silently removed mixtapes, loose singles and
 * bootlegs from search altogether.
 */

import { describe, expect, it, vi } from 'vitest';
import type { YtDlpMobileSearchHit } from './ytDlpMobile';

const hits: YtDlpMobileSearchHit[] = [
  {
    id: 'dQw4w9WgXcQ',
    title: 'DENZEL CURRY - 13LOOD 1N + 13LOOD OUT MIXX',
    artist: 'Denzel Curry',
    watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    durationSeconds: 254,
  },
];

vi.mock('./ytDlpMobile', () => ({ searchYtDlpMobile: async () => hits }));

const { searchYouTubeTracks } = await import('./youtubeSearch');

describe('searchYouTubeTracks', () => {
  it('prefixes ids so the supplement recognises its own rows', async () => {
    const tracks = await searchYouTubeTracks('denzel curry', 5);
    expect(tracks[0]!.id).toBe('youtube-dQw4w9WgXcQ');
    expect(tracks[0]!.envelope?.envelopeId).toBe('youtube-dQw4w9WgXcQ');
  });

  it('keeps the watch URL and duration the resolver needs', async () => {
    const tracks = await searchYouTubeTracks('denzel curry', 5);
    expect(tracks[0]!.envelope?.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(tracks[0]!.durationSeconds).toBe(254);
  });
});
