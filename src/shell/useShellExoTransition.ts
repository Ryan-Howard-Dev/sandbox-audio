/**
 * Native ExoPlayer gapless-transition adoption — listens for the native "track advanced on its
 * own" event, matches it back to a queue index, and (if it passes the R-018 adopt/ignore gate)
 * moves JS state to follow. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position: after the wifi-prefetch effect and the
 * playQueueRef/queueIndexRef/repeatModeRef/mixRadioSessionRef sync block, before
 * useShellQueueRestore. It reads repeatModeRef and exoGaplessTransitionAtRef, both already
 * declared earlier in the shell by this point, so there is no forward-reference risk here.
 */

import { useEffect, type MutableRefObject } from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { CandidateSource } from '../sandboxLayer1';
import type { RepeatMode } from '../queuePersistence';
import { findQueueIndexForExoTransition, isExoMediaItemTransitionEvent } from '../play/exoQueueSync';
import { shouldAdoptNativeExoTransition } from '../play/queueAdvanceGate';
import { lastJsInitiatedNativeNav } from '../androidNativePlayback';
import { logE2e } from '../e2eDevAction';
import { prefetchUpcomingQueueTracks } from '../trackPrefetch';

export type UseShellExoTransitionArgs = {
  audio: UseAudioFSMResult;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  queueIndexRef: MutableRefObject<number>;
  repeatModeRef: MutableRefObject<RepeatMode>;
  exoGaplessTransitionAtRef: MutableRefObject<number>;
  setQueueIndex: (index: number) => void;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  adoptInPlaceQueueTrack: (track: MediaEnvelope, index: number) => void | Promise<void>;
  primeLockerNativeQueueFrom: (tracks: MediaEnvelope[], fromIndex: number) => Promise<void>;
};

export function useShellExoTransition({
  audio,
  playQueueRef,
  audioEnvelopeRef,
  queueIndexRef,
  repeatModeRef,
  exoGaplessTransitionAtRef,
  setQueueIndex,
  syncThumbsFromFeedback,
  findHitCandidates,
  adoptInPlaceQueueTrack,
  primeLockerNativeQueueFrom,
}: UseShellExoTransitionArgs) {
  useEffect(() => {
    const onExoTransition = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isExoMediaItemTransitionEvent(detail)) return;
      void (async () => {
        const queue = playQueueRef.current;
        /*
         * mediaId first, URL as fallback — the remaining half of #36, now landed.
         *
         * This was deliberately left on URL matching because mediaId resolved skip echoes too and
         * caused a visible double-advance. shouldAdoptNativeExoTransition below is the real fix
         * for that: playUrl records what JS navigated to and echoes are ignored however they were
         * matched, so URL matching was only ever suppressing the race by accident.
         *
         * What forced the change: URL matching misses whenever the stream cache serves a track,
         * because the queue holds an https URL and the transition reports content://…stream-cache.
         * On a cached LibriVox book that meant JS adopted nothing — native advanced two chapters
         * while envelopeId stayed frozen on the first, so the queue index never moved.
         *
         * Verified on device, which is what it was waiting for: queue-skip-probe across chapter
         * boundaries on a 22-chapter book, index advancing by exactly one with no stray indexes.
         */
        const idx = await findQueueIndexForExoTransition(queue, {
          mediaId: detail.mediaId,
          url: detail.url,
        });
        if (idx < 0) return;
        const track = queue[idx];
        if (!track) return;
        const jsNav = lastJsInitiatedNativeNav();
        const adopt = shouldAdoptNativeExoTransition({
          transitionEnvelopeId: track.envelopeId,
          activeEnvelopeId: audioEnvelopeRef.current?.envelopeId,
          pendingJsNavEnvelopeId: jsNav.envelopeId,
          pendingJsNavAtMs: jsNav.atMs,
          reason: typeof detail.reason === 'number' ? detail.reason : undefined,
        });
        /*
         * Both sides of the R-018 race, in one line each. The probe can say the index overshot but
         * not why: an adopted echo and a second JS advance land identically. This prints the gate's
         * inputs at the moment it decides, so a failing run shows which one moved the index.
         */
        logE2e(
          'exo-transition',
          adopt,
          `idx=${idx} from=${queueIndexRef.current} reason=${detail.reason ?? 'none'} adopt=${adopt} sinceJsNavMs=${Date.now() - (jsNav.atMs || 0)} jsNavEnv=${jsNav.envelopeId ?? 'none'} transitionEnv=${track.envelopeId} activeEnv=${audioEnvelopeRef.current?.envelopeId ?? 'none'}`,
        );
        if (!adopt) {
          return;
        }
        exoGaplessTransitionAtRef.current = Date.now();
        setQueueIndex(idx);
        syncThumbsFromFeedback(track.envelopeId);
        void adoptInPlaceQueueTrack(track, 0);
        // Do NOT force trackReachedPlayingRef true here — a native transition is not proof this
        // track is actually audible yet (an erroneous/corrupted transition would "prove" it
        // instantly, defeating trackPlaybackMatureForAdvance's minimum-play-time guard and
        // letting a bad transition cascade into rapid-fire track skipping). Let the dedicated
        // state-driven effect confirm real playback before this flag flips.
        void primeLockerNativeQueueFrom(queue, idx);
        prefetchUpcomingQueueTracks({
          playQueue: playQueueRef.current,
          queueIndex: idx,
          repeatMode: repeatModeRef.current,
          findCandidates: findHitCandidates,
          onResolvedUrl: (url, envelope) =>
            audio.prebufferUrl(url, {
              title: envelope.title,
              artist: envelope.artist,
              album: envelope.album,
              artworkUrl: envelope.artworkUrl,
              envelopeId: envelope.envelopeId,
            }),
        });
      })();
    };
    window.addEventListener('sandbox-exo-media-transition', onExoTransition);
    return () => window.removeEventListener('sandbox-exo-media-transition', onExoTransition);
  }, [audio, syncThumbsFromFeedback, findHitCandidates, adoptInPlaceQueueTrack, primeLockerNativeQueueFrom]);
}
