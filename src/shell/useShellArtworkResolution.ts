/**
 * Artwork URL resolution — fetches missing album art from track metadata and backfills from the
 * locker (embedded art / adopted playback art) when the stream itself has none. Extracted from
 * sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position (after Connect runtime / queue refs are ready). The
 * idle seed/URL clear stays later in SandboxShell — moving it here would reorder effects relative
 * to stem mix and lyrics resolve.
 */

import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { UseAudioFSMResult, MediaEnvelope } from '../sandboxLayer1';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { fetchTrackMetadata } from '../sandboxLayer2';
import {
  coalesceArtworkUrl,
  proxiedArtworkUrl,
} from '../displaySanitize';
import {
  resolveLockerEntryAlbumArt,
  resolveLockerEntryId,
  stabilizePlaybackArtSrc,
} from '../playerBarTrackMeta';
import { adoptPlaybackLockerArtwork } from '../lockerStorage';

export type UseShellArtworkResolutionArgs = {
  audio: UseAudioFSMResult;
  artworkUrl: string;
  setArtworkUrl: Dispatch<SetStateAction<string>>;
  lockerEnvelopes: MediaEnvelope[];
};

export function useShellArtworkResolution({
  audio,
  artworkUrl,
  setArtworkUrl,
  lockerEnvelopes,
}: UseShellArtworkResolutionArgs) {
  useEffect(() => {
    if (!audio.title || !audio.artist || artworkUrl) return;
    if (audio.envelope?.envelopeId && isPodcastEnvelopeId(audio.envelope.envelopeId)) return;
    void fetchTrackMetadata(audio.artist, audio.title).then((meta) => {
      const fetched = coalesceArtworkUrl(meta.albumArt, audio.envelope?.artworkUrl);
      if (fetched) {
        setArtworkUrl((prev) => proxiedArtworkUrl(fetched) ?? fetched ?? prev);
      }
    });
  }, [audio.title, audio.artist, audio.envelope?.envelopeId, audio.envelope?.artworkUrl, artworkUrl]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env?.envelopeId) return;
    void (async () => {
      try {
        let raw = env.artworkUrl?.trim();
        if (!raw) {
          raw = resolveLockerEntryAlbumArt(env)?.trim() ?? '';
        }
        if (!raw) {
          const id = resolveLockerEntryId(env);
          if (id) raw = (await adoptPlaybackLockerArtwork(id)) ?? '';
        }
        if (!raw) return;
        const next = proxiedArtworkUrl(raw) ?? raw;
        setArtworkUrl((prev) => stabilizePlaybackArtSrc(prev, next, env.envelopeId) || next);
      } catch (err) {
        console.warn('[sandboxLayer3] artwork backfill failed:', err);
      }
    })();
  }, [
    audio.envelope?.envelopeId,
    audio.envelope?.artworkUrl,
    audio.envelope?.provider,
    audio.envelope?.sourceId,
    lockerEnvelopes,
  ]);
}
