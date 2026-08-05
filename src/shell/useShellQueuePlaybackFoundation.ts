/**
 * Queue/playback foundation refs and helpers for the shell — play generation, locker album-queue
 * seeding, native locker prebuffer priming, authoritative audio/now-playing refs, play-session
 * flush (taste + scrobble), and search-hit candidate lookup. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position, right after useShellConnect and before usePlayEnvelope —
 * handlePlayEnvelope and later queue/play wiring close over these refs and callbacks. Moving the
 * block earlier or later changes what is defined at those sites and can introduce TDZ failures.
 */

import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  CandidateSource,
  MediaEnvelope,
  UseAudioFSMResult,
} from '../sandboxLayer1';
import type { PlaybackDisplayFields } from '../playbackSession';
import type { RepeatMode } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';
import type { LockerEntry } from '../lockerStorage';
import {
  lockerTitleMatches,
  tracksForAlbumGroup,
} from '../lockerStorage';
import { sortLockerTracks } from '../lockerTrackOrder';
import { lockerEntryToEnvelope } from '../smartPlaylistEngine';
import {
  primeLockerNativeQueue,
  isLockerVaultPlayQueue,
} from '../trackPrefetch';
import { isAndroid } from '../platformEnv';
import { currentPlayGeneration } from '../playIntent';
import { computeSkipped, recordPlaySession } from '../playHistory';
import { scrobbleTrack } from '../scrobble';
import type { ResolvedSearchHit } from '../sandboxLayer2';

export type UseShellQueuePlaybackFoundationArgs = {
  audio: UseAudioFSMResult;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  mixRadioSessionRef: MutableRefObject<MixRadioSession | null>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  sessionEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  searchHitsRef: MutableRefObject<ResolvedSearchHit[]>;
};

export function useShellQueuePlaybackFoundation({
  audio,
  playQueueRef,
  queueIndexRef,
  setPlayQueue,
  setQueueIndex,
  setShuffleOn,
  setRepeatMode,
  setMixRadioSession,
  mixRadioSessionRef,
  autoSimilarRadioSeedRef,
  sessionEnvelopeRef,
  searchHitsRef,
}: UseShellQueuePlaybackFoundationArgs) {
  const playGenerationRef = useRef(0);
  playGenerationRef.current = currentPlayGeneration();
  const primeLockerNativeQueueFrom = useCallback(
    (tracks: MediaEnvelope[], fromIndex: number) => {
      if (!isAndroid() || !isLockerVaultPlayQueue(tracks) || fromIndex >= tracks.length - 1) {
        return Promise.resolve();
      }
      return primeLockerNativeQueue(
        tracks,
        fromIndex,
        (url, envelope) =>
          audio.prebufferUrl(url, {
            title: envelope.title,
            artist: envelope.artist,
            album: envelope.album,
            artworkUrl: envelope.artworkUrl,
            envelopeId: envelope.envelopeId,
          }),
        audio.flushNativeExoEnqueueChain,
      );
    },
    [audio.prebufferUrl, audio.flushNativeExoEnqueueChain],
  );

  const seedLockerAlbumPlayQueue = useCallback(
    (
      entries: LockerEntry[],
      albumTitle: string,
      artistName: string,
      selectedSourceId?: string,
      selectedTitle?: string,
    ): { envs: MediaEnvelope[]; index: number } | null => {
      const sorted = sortLockerTracks(tracksForAlbumGroup(entries, albumTitle, artistName));
      if (sorted.length < 2) return null;
      const envs = sorted.map((entry) => lockerEntryToEnvelope(entry));
      let index = -1;
      const sourceId = selectedSourceId?.trim();
      if (sourceId) {
        index = envs.findIndex((env) => env.sourceId === sourceId);
      }
      if (index < 0 && selectedTitle?.trim()) {
        index = envs.findIndex((env) => lockerTitleMatches(env.title, selectedTitle));
      }
      if (index < 0) return null;
      setPlayQueue(envs);
      setQueueIndex(index);
      playQueueRef.current = envs;
      queueIndexRef.current = index;
      setShuffleOn(false);
      setRepeatMode('none');
      setMixRadioSession(null);
      autoSimilarRadioSeedRef.current = null;
      return { envs, index };
    },
    [],
  );

  const logLockerQueueInstrumentation = useCallback(
    (
      phase: string,
      selectedSourceId: string | undefined,
      selectedIndex: number,
      envs: MediaEnvelope[],
    ) => {
      if (!import.meta.env.DEV) return;
      console.warn(
        `[locker-queue] ${phase} ${JSON.stringify({
          selectedTrackId: selectedSourceId ?? envs[selectedIndex]?.sourceId ?? 'unknown',
          selectedIndex,
          jsQueueIds: envs.map((env) => env.sourceId ?? env.envelopeId),
          trackTitles: envs.map((env) => env.title),
        })}`,
      );
    },
    [],
  );

  /**
   * What the screen currently says, for consumers that run outside render (the E2E playback probe).
   * Reading audio.envelope there reported the track being resolved, which is exactly the drift the
   * probe was built to detect.
   */
  const nowPlayingDisplayRef = useRef<PlaybackDisplayFields | null>(null);
  const authoritativeEnvelopeRef = useRef<MediaEnvelope | null>(null);
  const audioEnvelopeRef = useRef(audio.envelope);
  const audioStateRef = useRef(audio.state);
  audioEnvelopeRef.current = audio.envelope;
  audioStateRef.current = audio.state;
  const audioVolumeRef = useRef(audio.volume);
  audioVolumeRef.current = audio.volume;
  const audioCurrentTimeRef = useRef(audio.currentTimeSeconds);
  audioCurrentTimeRef.current = audio.currentTimeSeconds;
  const audioDurationRef = useRef(audio.durationSeconds);
  audioDurationRef.current = audio.durationSeconds;
  const audioStreamDurationRef = useRef(audio.streamDurationSeconds);
  audioStreamDurationRef.current = audio.streamDurationSeconds;
  /** True once the current track reaches Playing — gates gapless auto-advance. */
  const trackReachedPlayingRef = useRef(false);
  /** Wall-clock ms timestamp of the false->true edge above — see trackPlaybackMatureForAdvance. */
  const trackReachedPlayingAtRef = useRef(0);
  /** Native Exo gapless queue advanced — suppress duplicate JS resolve/advance. */
  const exoGaplessTransitionAtRef = useRef(0);
  /**
   * Envelope handed to the audio layer as an already-playable stream (tryInstantPlayable, sync
   * cache, locker hit). Those tracks start with no silent gap, so their metadata must swap at once
   * — holding the previous track's identity there would invent the very delay the fast path
   * removes.
   */
  const instantHandoffEnvelopeIdRef = useRef('');

  const sessionPeakSecondsRef = useRef(0);

  const flushPlaySession = useCallback((completed = false) => {
    const env = sessionEnvelopeRef.current;
    const peak = sessionPeakSecondsRef.current;
    if (env && peak >= 5) {
      const listenedMs = Math.floor(peak * 1000);
      const durationMs =
        env.durationSeconds != null && env.durationSeconds > 0
          ? Math.round(env.durationSeconds * 1000)
          : 0;
      const skipped =
        !completed && computeSkipped(listenedMs, durationMs, false);
      // Derive listening context so taste weighting can tell an album listen from a single tap.
      const queueNow = playQueueRef.current;
      const playContext: 'album' | 'single' | 'radio' | 'playlist' = mixRadioSessionRef.current
        ? 'radio'
        : queueNow.length > 1 && queueNow.some((tr) => tr.envelopeId === env.envelopeId)
          ? 'album'
          : 'single';
      recordPlaySession(env, peak, completed, skipped, playContext);
      if (completed || !skipped) {
        void scrobbleTrack(env, listenedMs);
      }
    }
    sessionPeakSecondsRef.current = 0;
    if (!completed) sessionEnvelopeRef.current = null;
  }, []);

  const findHitCandidates = useCallback(
    (env: MediaEnvelope): CandidateSource[] | undefined => {
      const hit = searchHitsRef.current.find(
        (h) => h.primaryEnvelope.envelopeId === env.envelopeId,
      );
      return hit?.sources;
    },
    [],
  );

  return {
    playGenerationRef,
    primeLockerNativeQueueFrom,
    seedLockerAlbumPlayQueue,
    logLockerQueueInstrumentation,
    nowPlayingDisplayRef,
    authoritativeEnvelopeRef,
    audioEnvelopeRef,
    audioStateRef,
    audioVolumeRef,
    audioCurrentTimeRef,
    audioDurationRef,
    audioStreamDurationRef,
    trackReachedPlayingRef,
    trackReachedPlayingAtRef,
    exoGaplessTransitionAtRef,
    instantHandoffEnvelopeIdRef,
    sessionPeakSecondsRef,
    flushPlaySession,
    findHitCandidates,
  };
}
