/**
 * skipBack / skipForward — the transport buttons' queue-advance logic, plus lastSkipOutcomeRef
 * (why the last skip did what it did, read by the E2E playback probe). Extracted from sandboxLayer3
 * as a single hook because the two callbacks share the same interval-seek-vs-queue-advance shape
 * and the same dependency set; splitting them into separate files would just duplicate the jsdoc.
 *
 * Call at the effect's original position in sandboxLayer3 (right after cycleRepeat, before the
 * audio.envelope -> sessionEnvelopeRef effect). lastSkipOutcomeRef is read by the E2E live-handlers
 * effect that sits *earlier* in the component (buildE2eLiveHandlers's deps) — that was already a
 * forward reference before this extraction (the ref was declared after that effect in the original
 * source too), and it stays safe for the same reason: the effect callback that reads it only runs
 * post-commit, by which point this hook has already run for that render and the ref exists.
 */
import { useCallback, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ConnectCommand } from '../tier34/connectProtocol';
import type { RepeatMode } from '../queuePersistence';

import { usesIntervalSeekTransport } from '../spokenWordPlayback';
import { seekIntervalsFor, seekTargetSeconds } from '../spokenSeekIntervals';
import { resolveMediaPillar } from '../mediaPillar';
import { loadPodcastSeekIntervalSeconds } from '../podcastSettings';
import { computeSkipBackIndex, recordShuffleAdvance } from '../play/queueAdvancePolicy';
import { resolveQueueTrackSeekTarget } from '../queueNavigation';
import { tryQueueInPlaceSeek } from '../play/playTapFastPath';
import { computeNextQueueIndexWithUpNext, loadSovereignUpNextSettings } from '../sovereignUpNext';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { logE2e } from '../e2eDevAction';

export type SkipOutcome = '' | 'remote' | 'seek' | 'none' | 'no-track' | 'in-place' | 'advance';

export type ShellSkipControlsArgs = {
  isConnectRemoteRef: MutableRefObject<boolean>;
  sendConnectCommand: (command: ConnectCommand) => void;
  audio: UseAudioFSMResult;
  queueIndex: number;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  playQueue: MediaEnvelope[];
  repeatMode: RepeatMode;
  shuffleOn: boolean;
  /** Shared with the ended-handler: skipping and finishing a track advance the same cycle. */
  shufflePlayedRef: MutableRefObject<number[]>;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
  adoptInPlaceQueueTrack: (track: MediaEnvelope, seekSeconds: number) => Promise<void>;
  handlePlayEnvelope: (
    envelope: MediaEnvelope,
    candidates?: CandidateSource[],
    opts?: {
      autoPlay?: boolean;
      seedSearchQueue?: boolean;
      seedSearchEnvelope?: MediaEnvelope;
      seamless?: boolean;
      preservePlayQueue?: boolean;
    },
  ) => Promise<boolean>;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  sovereignUpNextPodcastCountRef: MutableRefObject<number>;
};

export function useShellSkipControls({
  isConnectRemoteRef,
  sendConnectCommand,
  audio,
  queueIndex,
  setQueueIndex,
  playQueue,
  repeatMode,
  shuffleOn,
  shufflePlayedRef,
  syncThumbsFromFeedback,
  adoptInPlaceQueueTrack,
  handlePlayEnvelope,
  findHitCandidates,
  sovereignUpNextPodcastCountRef,
}: ShellSkipControlsArgs) {
  const skipBack = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'SKIP_PREV' });
      return;
    }
    // Audiobooks included: a twelve-hour book had music's transport, so this button jumped a
    // whole chapter instead of stepping back a few seconds. See spokenWordPlayback.
    //
    // Back is deliberately shorter than forward. Pressing it means a name or a clause went past
    // while you were doing something else, and the shortest jump that recovers it is the right
    // one; the same thirty seconds that usefully clears a sponsor read puts you back into a
    // minute you already understood. See spokenSeekIntervals.
    if (audio.envelope && usesIntervalSeekTransport(audio.envelope.envelopeId)) {
      const { back } = seekIntervalsFor(
        resolveMediaPillar({ envelopeId: audio.envelope.envelopeId }),
        loadPodcastSeekIntervalSeconds(),
      );
      audio.seek(
        seekTargetSeconds({
          currentSeconds: audio.currentTimeSeconds,
          deltaSeconds: -back,
          durationSeconds:
            audio.streamDurationSeconds ||
            audio.durationSeconds ||
            audio.envelope.durationSeconds ||
            0,
        }),
      );
      return;
    }
    const back = computeSkipBackIndex({
      queueIndex,
      queueLength: playQueue.length,
      currentTimeSeconds: audio.currentTimeSeconds,
    });
    if (back === 'seek-start') {
      audio.seek(
        playQueue.length > 0
          ? resolveQueueTrackSeekTarget(playQueue, queueIndex)
          : 0,
      );
      return;
    }
    const prev = back;
    const track = playQueue[prev];
    if (!track) return;
    const currentUrl = audio.envelope?.url?.trim() ?? '';
    const inPlaceSeek = tryQueueInPlaceSeek({
      playQueue,
      queueIndex,
      targetQueueIdx: prev,
      currentUrl,
      streamDurationSeconds: audio.streamDurationSeconds,
      envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
    });
    if (currentUrl && inPlaceSeek != null) {
      setQueueIndex(prev);
      syncThumbsFromFeedback(track.envelopeId);
      void adoptInPlaceQueueTrack(track, inPlaceSeek);
      return;
    }
    setQueueIndex(prev);
    void handlePlayEnvelope(track, findHitCandidates(track));
  }, [
    audio,
    playQueue,
    queueIndex,
    handlePlayEnvelope,
    findHitCandidates,
    sendConnectCommand,
    syncThumbsFromFeedback,
    adoptInPlaceQueueTrack,
  ]);

  /*
   * Why the last skip did what it did. A skip that Up Next declines ('none') and a skip the queue
   * loses look identical from outside — both leave the index where it was — so the probe could
   * only ever report "did not advance". Recorded here so it can report which.
   */
  const lastSkipOutcomeRef = useRef<SkipOutcome>('');

  const skipForward = useCallback(() => {
    lastSkipOutcomeRef.current = '';
    if (isConnectRemoteRef.current) {
      lastSkipOutcomeRef.current = 'remote';
      sendConnectCommand({ cmd: 'SKIP_NEXT' });
      return;
    }
    if (audio.envelope && usesIntervalSeekTransport(audio.envelope.envelopeId)) {
      // Forward keeps the configured interval: that setting was always really about how much
      // sponsor read or theme music one press should clear.
      const { forward } = seekIntervalsFor(
        resolveMediaPillar({ envelopeId: audio.envelope.envelopeId }),
        loadPodcastSeekIntervalSeconds(),
      );
      lastSkipOutcomeRef.current = 'seek';
      audio.seek(
        seekTargetSeconds({
          currentSeconds: audio.currentTimeSeconds,
          deltaSeconds: forward,
          durationSeconds:
            audio.streamDurationSeconds ||
            audio.durationSeconds ||
            audio.envelope.durationSeconds ||
            0,
        }),
      );
      return;
    }
    const upNextSettings = loadSovereignUpNextSettings();
    const advance = computeNextQueueIndexWithUpNext({
      queueIndex,
      queueLength: playQueue.length,
      repeatMode: repeatMode === 'one' ? 'none' : repeatMode,
      shuffleOn,
      playedIndices: shufflePlayedRef.current,
      queue: playQueue,
      settings: upNextSettings,
    });
    if (advance.action === 'none') {
      lastSkipOutcomeRef.current = 'none';
      return;
    }
    shufflePlayedRef.current = recordShuffleAdvance(
      shufflePlayedRef.current,
      queueIndex,
      advance,
    );
    const next =
      advance.action === 'repeat-one'
        ? queueIndex
        : advance.action === 'wrap' || advance.action === 'advance'
          ? advance.index
          : queueIndex;
    const track = playQueue[next];
    if (!track) {
      lastSkipOutcomeRef.current = 'no-track';
      return;
    }
    if (!isPodcastEnvelopeId(track.envelopeId)) {
      sovereignUpNextPodcastCountRef.current = 0;
    }
    const currentUrl = audio.envelope?.url?.trim() ?? '';
    const inPlaceSeek = tryQueueInPlaceSeek({
      playQueue,
      queueIndex,
      targetQueueIdx: next,
      currentUrl,
      streamDurationSeconds: audio.streamDurationSeconds,
      envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
    });
    if (currentUrl && inPlaceSeek != null && !(inPlaceSeek < 0.25 && next > 0)) {
      setQueueIndex(next);
      syncThumbsFromFeedback(track.envelopeId);
      lastSkipOutcomeRef.current = 'in-place';
      void adoptInPlaceQueueTrack(track, inPlaceSeek);
      return;
    }
    lastSkipOutcomeRef.current = 'advance';
    logE2e('js-skip', true, `from=${queueIndex} to=${next} env=${track.envelopeId}`);
    setQueueIndex(next);
    void handlePlayEnvelope(track, findHitCandidates(track), { preservePlayQueue: true });
  }, [
    audio,
    playQueue,
    queueIndex,
    repeatMode,
    shuffleOn,
    handlePlayEnvelope,
    findHitCandidates,
    sendConnectCommand,
    syncThumbsFromFeedback,
    adoptInPlaceQueueTrack,
  ]);

  return { skipBack, skipForward, lastSkipOutcomeRef };
}
