/**
 * What happens when the current track ends — sleep timer, native-gapless suppression, repeat-one,
 * sovereign Up Next, mix-radio queue extension, lone-track auto-similar-radio, and the ordinary
 * advance-to-next-track path (in-place seek fast path or a fresh resolve). Extracted from
 * sandboxLayer3 as a single side-effect hook (no return value) because it is one
 * audio.subscribeEnded callback with no JSX and no state of its own — every identifier below is
 * either a ref the shell already owns, a setter, or a plain callback/imported pure function.
 *
 * Call at the effect's original position in sandboxLayer3 (right after the native-Exo
 * reachedPlaying-state effect, before usePlaybackQueue). All refs/setters/callbacks passed in are
 * declared earlier in sandboxLayer3 than this call, so there is no forward-reference concern here
 * (unlike the two E2E-handler extractions).
 */
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { MixRadioSession } from '../playerMixRadio';
import type { RepeatMode } from '../queuePersistence';

import { handleSleepTimerTrackEnd } from '../sleepTimer';
import { resolveNativeExoTransitionPrefs } from '../androidWiredDacPlayback';
import { shouldSuppressJsAdvanceAfterNativeGapless, trackPlaybackMatureForAdvance } from '../play/queueAdvanceGate';
import { tryExtendMixRadioQueue } from '../play/queueAdvancePolicy';
import { tryQueueInPlaceSeek } from '../play/playTapFastPath';
import { startAutoSimilarRadioIfNeeded } from '../play/standaloneSimilarRadio';
import {
  computeNextQueueIndexWithUpNext,
  loadSovereignUpNextSettings,
  shouldStopUpNextAfterPodcast,
} from '../sovereignUpNext';
import { buildDiscoveryMixContinuation } from '../discoveryMixRadio';
import { isPodcastEnvelopeId } from '../podcastStorage';

export type ShellQueueAdvanceOnEndedArgs = {
  audio: UseAudioFSMResult;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
  repeatModeRef: MutableRefObject<RepeatMode>;
  shuffleOnRef: MutableRefObject<boolean>;
  audioCurrentTimeRef: MutableRefObject<number>;
  audioStreamDurationRef: MutableRefObject<number>;
  audioDurationRef: MutableRefObject<number>;
  trackReachedPlayingRef: MutableRefObject<boolean>;
  trackReachedPlayingAtRef: MutableRefObject<number>;
  sessionPeakSecondsRef: MutableRefObject<number>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  exoGaplessTransitionAtRef: MutableRefObject<number>;
  playEnvelopeRef: MutableRefObject<
    (
      envelope: MediaEnvelope,
      candidates?: CandidateSource[],
      opts?: {
        autoPlay?: boolean;
        seedSearchQueue?: boolean;
        seedSearchEnvelope?: MediaEnvelope;
        seamless?: boolean;
        preservePlayQueue?: boolean;
      },
    ) => Promise<boolean>
  >;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  searchHitsRef: MutableRefObject<ResolvedSearchHit[]>;
  mixRadioSessionRef: MutableRefObject<MixRadioSession | null>;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  primeLockerNativeQueueFrom: (tracks: MediaEnvelope[], fromIndex: number) => Promise<void>;
  sovereignUpNextPodcastCountRef: MutableRefObject<number>;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  adoptInPlaceQueueTrack: (track: MediaEnvelope, seekSeconds: number) => Promise<void>;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
};

export function useShellQueueAdvanceOnEnded({
  audio,
  playQueueRef,
  queueIndexRef,
  repeatModeRef,
  shuffleOnRef,
  audioCurrentTimeRef,
  audioStreamDurationRef,
  audioDurationRef,
  trackReachedPlayingRef,
  trackReachedPlayingAtRef,
  sessionPeakSecondsRef,
  audioEnvelopeRef,
  exoGaplessTransitionAtRef,
  playEnvelopeRef,
  findHitCandidates,
  searchHitsRef,
  mixRadioSessionRef,
  setPlayQueue,
  setQueueIndex,
  setMixRadioSession,
  setRepeatMode,
  setShuffleOn,
  autoSimilarRadioSeedRef,
  primeLockerNativeQueueFrom,
  sovereignUpNextPodcastCountRef,
  showAppToast,
  t,
  adoptInPlaceQueueTrack,
  syncThumbsFromFeedback,
}: ShellQueueAdvanceOnEndedArgs): void {
  useEffect(() => {
    return audio.subscribeEnded(() => {
      const handled = handleSleepTimerTrackEnd({
        queueLength: playQueueRef.current.length,
        queueIndex: queueIndexRef.current,
        repeatMode: repeatModeRef.current,
      });
      if (handled) return;

      if (
        !trackPlaybackMatureForAdvance({
          reachedPlaying: trackReachedPlayingRef.current,
          peakSeconds: sessionPeakSecondsRef.current,
          currentSeconds: audioCurrentTimeRef.current,
          msSinceReachedPlaying: trackReachedPlayingRef.current
            ? Date.now() - trackReachedPlayingAtRef.current
            : undefined,
        })
      ) {
        return;
      }
      trackReachedPlayingRef.current = false;
      trackReachedPlayingAtRef.current = 0;
      const seamless = resolveNativeExoTransitionPrefs().gapless;
      const endedEnvForSuppress = audioEnvelopeRef.current;
      if (
        shouldSuppressJsAdvanceAfterNativeGapless({
          seamless,
          gaplessTransitionAtMs: exoGaplessTransitionAtRef.current,
          endedEnvelopeId: endedEnvForSuppress?.envelopeId,
          queueIndex: queueIndexRef.current,
          playQueue: playQueueRef.current,
        })
      ) {
        return;
      }
      const env = audioEnvelopeRef.current;
      if (repeatModeRef.current === 'one' && env) {
        void playEnvelopeRef.current(env, findHitCandidates(env));
        return;
      }
      const q = playQueueRef.current;
      const upNextSettings = loadSovereignUpNextSettings();
      const endedEnv = audioEnvelopeRef.current;
      if (
        upNextSettings.enabled &&
        endedEnv &&
        isPodcastEnvelopeId(endedEnv.envelopeId)
      ) {
        sovereignUpNextPodcastCountRef.current += 1;
        if (
          shouldStopUpNextAfterPodcast(
            upNextSettings,
            sovereignUpNextPodcastCountRef.current,
            endedEnv,
          )
        ) {
          showAppToast(
            t('player.sovereignUpNext.stoppedAfterN', {
              count: upNextSettings.stopAfterEpisodes,
            }),
          );
          return;
        }
      }
      const advance = computeNextQueueIndexWithUpNext({
        queueIndex: queueIndexRef.current,
        queueLength: q.length,
        repeatMode: repeatModeRef.current,
        shuffleOn: shuffleOnRef.current,
        queue: q,
        settings: upNextSettings,
      });
      if (advance.action === 'none') {
        const mixExtend = tryExtendMixRadioQueue({
          mixSession: mixRadioSessionRef.current,
          current: audioEnvelopeRef.current,
          queue: q,
          buildContinuation: (seed, exclude, count) =>
            buildDiscoveryMixContinuation(
              mixRadioSessionRef.current ?? { kind: 'radio', seedTitle: '', seedArtist: '' },
              seed,
              exclude,
              count,
            ),
        });
        if (mixExtend.action === 'extend') {
          const base = playQueueRef.current;
          setPlayQueue([...base, ...mixExtend.tracks]);
          setQueueIndex(mixExtend.startIndex);
          void playEnvelopeRef.current(
            mixExtend.tracks[0]!,
            findHitCandidates(mixExtend.tracks[0]!),
            { seamless },
          );
          return;
        }
        // Lone single dead-end: build Track radio playlist + continue into next song.
        const ended = audioEnvelopeRef.current;
        if (ended && !isPodcastEnvelopeId(ended.envelopeId)) {
          /*
           * A lone single, or a queue that genuinely has nowhere left to go.
           *
           * These two flags used to be hardcoded true/false, which switched off every guard in
           * shouldAutoStartSimilarRadio — including the one that refuses to build a radio queue
           * around a track that is already sitting in a real queue. At the end of a twenty track
           * album that meant the album was replaced by a radio queue.
           *
           * It went unnoticed because buildTrackRadio almost always came back with nothing to put
           * in that queue, so the replacement never happened. Teaching it to look up the billed
           * artist made it succeed — and turned a dormant bug into tracks jumping around mid
           * listen. The guards were right; passing them the truth is all that was needed.
           */
          const endedInQueue = playQueueRef.current.some(
            (track) => track.envelopeId === ended.envelopeId,
          );
          void startAutoSimilarRadioIfNeeded(
            {
              envelope: ended,
              playQueue: playQueueRef.current,
              searchHits: searchHitsRef.current,
              seedSearchQueue: playQueueRef.current.length <= 1 || !endedInQueue,
              hasMixRadioSession: Boolean(mixRadioSessionRef.current),
            },
            {
              setPlayQueue,
              setQueueIndex,
              setMixRadioSession,
              setRepeatMode,
              setShuffleOn,
              isStillCurrent: () => audioEnvelopeRef.current?.envelopeId === ended.envelopeId,
              labelFor: (key) =>
                key === 'unknownTitle' ? t('player.unknownTitle') : t('player.unknownArtist'),
              persistRadioPlaylist: true,
            },
          ).then((result) => {
            if (!result.started) {
              /*
               * Say so. This is the most-asked-for behaviour in the app and its failure mode was
               * complete silence: the track ended, the bar sat at its own duration, and nothing
               * distinguished "could not find anything to play next" from "this was never built".
               * Both producers can legitimately come back empty — an artist the catalog does not
               * know, a locker with no playable rows — and that is worth one line on screen.
               */
              showAppToast(t('player.radioNoContinuation'), 4200);
              return;
            }
            autoSimilarRadioSeedRef.current = ended.envelopeId;
            const q2 = result.queue;
            const nextIdx = q2.findIndex((tr) => tr.envelopeId === ended.envelopeId);
            const playIdx = nextIdx >= 0 && nextIdx + 1 < q2.length ? nextIdx + 1 : 1;
            const nextTrack = q2[playIdx];
            if (nextTrack && nextTrack.envelopeId !== ended.envelopeId) {
              setQueueIndex(playIdx);
              void playEnvelopeRef.current(nextTrack, findHitCandidates(nextTrack), {
                seamless,
              }).then((started) => {
                if (started) void primeLockerNativeQueueFrom(q2, playIdx);
              });
            }
          });
        }
        return;
      }
      if (advance.action === 'repeat-one' && env) {
        void playEnvelopeRef.current(env, findHitCandidates(env));
        return;
      }
      const next =
        advance.action === 'wrap' || advance.action === 'advance' ? advance.index : 0;
      setQueueIndex(next);
      const track = q[next];
      if (track && !isPodcastEnvelopeId(track.envelopeId)) {
        sovereignUpNextPodcastCountRef.current = 0;
      }
      if (track) {
        const currentUrl = audioEnvelopeRef.current?.url?.trim() ?? '';
        const inPlaceSeek = tryQueueInPlaceSeek({
          playQueue: q,
          queueIndex: queueIndexRef.current,
          targetQueueIdx: next,
          currentUrl,
          streamDurationSeconds: audioStreamDurationRef.current,
          envelopeDurationSeconds: audioDurationRef.current,
        });
        if (currentUrl && inPlaceSeek != null && !(inPlaceSeek < 0.25 && next > 0)) {
          setQueueIndex(next);
          syncThumbsFromFeedback(track.envelopeId);
          void adoptInPlaceQueueTrack(track, inPlaceSeek);
          // See onExoTransition above — an in-place seek isn't proof of real playback either;
          // let the state-driven effect confirm it before trackPlaybackMatureForAdvance trusts it.
          void primeLockerNativeQueueFrom(q, next);
          return;
        }
        void playEnvelopeRef.current(track, findHitCandidates(track), {
          seamless,
          preservePlayQueue: true,
        }).then((started) => {
          if (started) void primeLockerNativeQueueFrom(q, next);
        });
      }
    });
  }, [audio, findHitCandidates, showAppToast, t, adoptInPlaceQueueTrack, primeLockerNativeQueueFrom]);
}
