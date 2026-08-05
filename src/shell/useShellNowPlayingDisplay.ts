/**
 * Now-playing display resolution, chapter marks, and togglePlay — extracted from sandboxLayer3
 * with no JSX. Three hooks, called at their three original (non-adjacent) positions rather than
 * one combined hook, for the same reason useShellNowPlaying.ts splits lyrics from media-session
 * wiring: each one's source position sits after a different set of render-prep state that the
 * others don't need, and merging them would force at least one to run at the wrong point relative
 * to the unrelated memos/effects between their original positions in SandboxShell.
 *
 * - useShellNowPlayingDisplay — call where liveNowPlayingDisplay used to be declared (after
 *   lockerFeatured/hasActivePlayback exist). Owns the held/live authority resolve and the
 *   homeTitle/Artist/Album/Art/DisplayState derived from it, plus the three effects that commit an
 *   audible track into heldNowPlaying, toast on a hold timing out, and clear heldNowPlaying on
 *   stop. Write nowPlayingDisplayRef.current / authoritativeEnvelopeRef.current from the caller
 *   right after this call, same as before — those refs are declared far earlier in sandboxLayer3
 *   (for the E2E playback probe) and are cheaper to keep assigned at the call site than threaded
 *   in as extra hook params.
 *
 * - useShellNowPlayingChapters — call where npCurrentTimeSeconds used to be declared, after
 *   serverStemMix/lyricsEnvelope exist and after useShellNowPlayingDisplay's authoritativeEnvelope
 *   is available. PRESERVE useAudiobookChapters/useBookChapterScan and bookChapterMarks exactly as
 *   they are — do not change their enabled/inputs logic, only where the surrounding code lives.
 *
 * - useShellTogglePlay — call where togglePlay used to be declared. Has no dependency on anything
 *   from the other two hooks (only on serverStemMix, isConnectRemoteRef, remoteMirror,
 *   sendConnectCommand, audio, showAppToast, t, persistLockerPlayRepair), so its position relative
 *   to them is not load-bearing; kept as a separate call purely to mirror the original source
 *   order for anyone diffing against history.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ServerStemMixState } from '../hooks/useServerStemMix';
import type { ConnectCommand, SyncStatePayload } from '../tier34/connectProtocol';
import {
  resolveNowPlayingDisplay,
  type PlaybackDisplayFields,
} from '../playbackSession';
import {
  applyNowPlayingAuthority,
  isNowPlayingCommitCurrent,
  nextHeldNowPlaying,
  resolveAuthoritativeEnvelope,
  resolveNowPlayingAuthority,
  shouldCommitAudibleNowPlaying,
  type HeldNowPlaying,
  type NowPlayingAuthorityDecision,
} from '../nowPlayingAuthority';
import { resolvePlaybackCoverArt } from '../playerBarTrackMeta';
import { proxiedArtworkUrl } from '../displaySanitize';
import { bumpPlayGeneration, currentPlayGeneration } from '../playIntent';
import {
  getActiveChapter,
  seekSecondsForNextChapter,
  type PodcastChapter,
} from '../podcastChapters';
import { resolveChapterWindow, type ChapterMark } from '../chapterScrubber';
import { useAudiobookChapters } from '../hooks/useAudiobookChapters';
import { useBookChapterScan } from '../hooks/useBookChapterScan';
import { isAnyAudiobookEnvelopeId } from '../spokenWordPlayback';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { resolveCatalogAwareDuration } from '../catalogPlaybackDuration';
import { shouldRunLockerPlaybackGate, ensureLockerPlayable } from '../play/ensureLockerPlayable';
import { attemptDeadLockerReacquire } from '../lockerDeadTrackReacquire';
import { preserveTappedEnvelopeIdentity } from '../playbackPipeline';

/** ---- 1. liveNowPlayingDisplay / authoritativeEnvelope / nowPlayingDisplay / home art -------- */

export type ShellNowPlayingDisplayArgs = {
  audio: UseAudioFSMResult;
  playbackDisplaySeed: PlaybackDisplayFields | null;
  artworkUrl: string;
  lockerFeatured: MediaEnvelope | null;
  hasActivePlayback: boolean;
  heldNowPlaying: HeldNowPlaying | null;
  setHeldNowPlaying: Dispatch<SetStateAction<HeldNowPlaying | null>>;
  instantHandoffEnvelopeIdRef: MutableRefObject<string>;
  playbackResolveElapsed: number;
  lockerEnvelopes: MediaEnvelope[];
  playGenerationRef: MutableRefObject<number>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
};

export function useShellNowPlayingDisplay({
  audio,
  playbackDisplaySeed,
  artworkUrl,
  lockerFeatured,
  hasActivePlayback,
  heldNowPlaying,
  setHeldNowPlaying,
  instantHandoffEnvelopeIdRef,
  playbackResolveElapsed,
  lockerEnvelopes,
  playGenerationRef,
  audioEnvelopeRef,
  showAppToast,
  t,
  setMobilePlayerPending,
}: ShellNowPlayingDisplayArgs) {
  const liveNowPlayingDisplay = useMemo(
    () =>
      resolveNowPlayingDisplay({
        audioEnvelope: audio.envelope,
        audioTitle: audio.title,
        audioArtist: audio.artist,
        audioState: audio.state,
        displaySeed: playbackDisplaySeed,
        parallelArtworkUrl: artworkUrl,
        lockerFeatured,
        currentTimeSeconds: audio.currentTimeSeconds,
        hasActivePlayback,
      }),
    [
      audio.envelope,
      audio.envelope?.envelopeId,
      audio.envelope?.artworkUrl,
      audio.title,
      audio.artist,
      audio.state,
      audio.currentTimeSeconds,
      playbackDisplaySeed,
      artworkUrl,
      lockerFeatured,
      hasActivePlayback,
    ],
  );
  /*
   * Not memoized on purpose: startedInstantly is read from a ref that the fast paths write
   * microseconds before the state change that would invalidate a memo, and a stale memo there
   * would put a spinner on a track that is already playing.
   */
  const nowPlayingAuthority: NowPlayingAuthorityDecision = resolveNowPlayingAuthority({
    loadingEnvelopeId: audio.envelope?.envelopeId,
    heldEnvelopeId: heldNowPlaying?.envelopeId,
    // The snapshot is dropped when playback stops, so a surviving snapshot is a stream that is
    // still on the speaker (or paused on it) and therefore still owns the screen.
    heldStillAudible: Boolean(heldNowPlaying),
    audioState: audio.state,
    startedInstantly:
      Boolean(audio.envelope?.envelopeId) &&
      instantHandoffEnvelopeIdRef.current === audio.envelope.envelopeId,
    loadElapsedMs: playbackResolveElapsed * 1000,
  });
  const authoritativeEnvelope = resolveAuthoritativeEnvelope(
    nowPlayingAuthority,
    audio.envelope,
    heldNowPlaying,
  );
  /*
   * Last position the audible track was seen at. Recorded only while its own metadata is on screen,
   * so the hold below cannot overwrite it with the incoming track's clock and show the previous
   * song scrubbed back to zero.
   */
  const heldPositionSecondsRef = useRef(0);
  if (nowPlayingAuthority.source !== 'held') {
    heldPositionSecondsRef.current = audio.currentTimeSeconds;
  }
  const heldPositionSeconds = heldPositionSecondsRef.current;
  const nowPlayingDisplay = useMemo(
    () =>
      applyNowPlayingAuthority(nowPlayingAuthority, liveNowPlayingDisplay, heldNowPlaying, {
        heldPositionSeconds,
        livePositionSeconds: audio.currentTimeSeconds,
      }),
    [
      nowPlayingAuthority.source,
      nowPlayingAuthority.envelopeId,
      liveNowPlayingDisplay,
      heldNowPlaying,
      heldPositionSeconds,
      audio.currentTimeSeconds,
    ],
  );
  const homeTitle = nowPlayingDisplay.title;
  const homeArtist = nowPlayingDisplay.artist;
  const homeAlbum = nowPlayingDisplay.album;
  const homeArtRaw = useMemo(() => {
    const parallel = nowPlayingDisplay.artworkUrl?.trim() || artworkUrl?.trim() || '';
    return resolvePlaybackCoverArt(parallel, authoritativeEnvelope);
  }, [
    nowPlayingDisplay.artworkUrl,
    artworkUrl,
    authoritativeEnvelope,
    authoritativeEnvelope?.envelopeId,
    authoritativeEnvelope?.provider,
    authoritativeEnvelope?.sourceId,
    lockerEnvelopes,
  ]);
  const homeArt = proxiedArtworkUrl(homeArtRaw) ?? homeArtRaw;
  const homeDisplayState: typeof audio.state =
    audio.envelope || audio.state !== 'Idle'
      ? audio.state
      : lockerFeatured
        ? 'Ready'
        : 'Idle';

  /*
   * Take over the screen only once the stream is the one making sound.
   *
   * Five fast presses of next leave four earlier loads racing behind the fifth, and the identity
   * check below discards any of them that lands late — committing a track the user has already
   * skipped past is the original bug arriving from behind. The audio layer's own play tokens stop
   * a stale load from ever attaching; this is the same guard at the display end, where a snapshot
   * captured in one render must not be written after a later render has moved on.
   */
  useEffect(() => {
    const env = audio.envelope;
    const envelopeId = env?.envelopeId ?? '';
    if (!shouldCommitAudibleNowPlaying(audio.state, envelopeId)) return;
    if (
      !isNowPlayingCommitCurrent(
        { envelopeId, playToken: playGenerationRef.current },
        {
          envelopeId: audioEnvelopeRef.current?.envelopeId,
          playToken: currentPlayGeneration(),
        },
      )
    ) {
      return;
    }
    setHeldNowPlaying((prev) =>
      nextHeldNowPlaying(prev, { envelopeId, display: liveNowPlayingDisplay, envelope: env }),
    );
  }, [audio.state, audio.envelope, liveNowPlayingDisplay]);

  /**
   * One give-up per abandoned load. Without the key the toast would re-fire on every render for as
   * long as the failed envelope stayed loaded.
   */
  const abandonedLoadKeyRef = useRef('');
  useEffect(() => {
    if (nowPlayingAuthority.reason !== 'hold-timed-out') return;
    const key = `${audio.envelope?.envelopeId ?? ''}:${playGenerationRef.current}`;
    if (abandonedLoadKeyRef.current === key) return;
    abandonedLoadKeyRef.current = key;
    /*
     * The stream never arrived. This is the same cancellation the stuck-playback watchdog performs,
     * taken 70 seconds sooner: the alternative is a spinner sitting on top of a track that was
     * playing fine, for a minute and a half, which is the stranded-UI failure this fix is not
     * allowed to introduce. The screen keeps the audible track's identity throughout; where the
     * app's existing failure recovery cannot heal the stream it clears the player, which is its
     * settled answer to "this will not play" and is at least never a lie.
     */
    bumpPlayGeneration();
    playGenerationRef.current = currentPlayGeneration();
    setMobilePlayerPending(false);
    audio.failResolve();
    const stillPlaying = heldNowPlaying?.display?.title?.trim();
    showAppToast(
      stillPlaying
        ? t('player.skipResolveGaveUp', { title: stillPlaying })
        : t('player.skipResolveGaveUpUnknown'),
      5000,
    );
  }, [
    nowPlayingAuthority.reason,
    audio.envelope?.envelopeId,
    audio,
    heldNowPlaying,
    showAppToast,
    t,
  ]);

  /** A stop leaves nothing on the speaker, so there is no longer an audible track to protect. */
  useEffect(() => {
    if (!audio.envelope && audio.state === 'Idle') setHeldNowPlaying(null);
  }, [audio.envelope, audio.state]);

  return {
    liveNowPlayingDisplay,
    nowPlayingAuthority,
    authoritativeEnvelope,
    nowPlayingDisplay,
    homeTitle,
    homeArtist,
    homeAlbum,
    homeArt,
    homeDisplayState,
  };
}

/** ---- 2. now-playing transport clocks + chapter marks + chapter window ------------------------ */

export type ShellNowPlayingChaptersArgs = {
  serverStemMix: ServerStemMixState;
  isConnectRemote: boolean;
  remoteMirror: SyncStatePayload | null;
  nowPlayingAuthority: NowPlayingAuthorityDecision;
  nowPlayingDisplay: PlaybackDisplayFields;
  audio: UseAudioFSMResult;
  lockerFeatured: MediaEnvelope | null;
  lyricsEnvelope: MediaEnvelope | null;
  authoritativeEnvelope: MediaEnvelope | null;
  podcastChapters: PodcastChapter[];
  playQueue: MediaEnvelope[];
  queueIndex: number;
  homeTitle: string;
  homeArtist: string;
  homeAlbum: string | undefined;
};

export function useShellNowPlayingChapters({
  serverStemMix,
  isConnectRemote,
  remoteMirror,
  nowPlayingAuthority,
  nowPlayingDisplay,
  audio,
  lockerFeatured,
  lyricsEnvelope,
  authoritativeEnvelope,
  podcastChapters,
  playQueue,
  queueIndex,
  homeTitle,
  homeArtist,
  homeAlbum,
}: ShellNowPlayingChaptersArgs) {
  const npCurrentTimeSeconds = serverStemMix.stemMixActive
    ? serverStemMix.stemTimeSeconds
    : isConnectRemote && remoteMirror
      ? remoteMirror.currentTimeSeconds
      : nowPlayingAuthority.source === 'held'
        ? nowPlayingDisplay.positionSeconds
        : audio.currentTimeSeconds;
  const npDurationSeconds =
    isConnectRemote && remoteMirror && remoteMirror.durationSeconds > 0
      ? remoteMirror.durationSeconds
      : nowPlayingAuthority.source === 'held'
        ? // beginResolve has already adopted the resolving track's length; the scrubber has to keep
          // describing the track you can hear, or a 3-minute song reads as a 9-minute one.
          nowPlayingDisplay.durationSeconds || 0
        : (() => {
          const catalog =
            audio.envelope?.durationSeconds ??
            lockerFeatured?.durationSeconds ??
            0;
          const stream = audio.streamDurationSeconds;
          if (stream > 0) {
            return (
              resolveCatalogAwareDuration(stream, catalog || audio.durationSeconds) ||
              stream
            );
          }
          return (
            audio.durationSeconds ||
            catalog ||
            0
          );
        })();
  const npIsPlaying = serverStemMix.stemMixActive
    ? serverStemMix.stemPlaying
    : isConnectRemote && remoteMirror
      ? remoteMirror.isPlaying
      : audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
  const npEnvelope = isConnectRemote ? lyricsEnvelope : authoritativeEnvelope;
  const npIsPodcast = Boolean(
    npEnvelope?.envelopeId && isPodcastEnvelopeId(npEnvelope.envelopeId),
  );
  const npIsBusy =
    !isConnectRemote &&
    !npIsPodcast &&
    (audio.state === 'Resolving' || audio.state === 'Connecting');
  const activePodcastChapter = useMemo(
    () =>
      npIsPodcast ? getActiveChapter(podcastChapters, npCurrentTimeSeconds) : null,
    [npIsPodcast, podcastChapters, npCurrentTimeSeconds],
  );
  const canPodcastPrevChapter =
    npIsPodcast && podcastChapters.length > 0 && npCurrentTimeSeconds > 1;
  const canPodcastNextChapter =
    npIsPodcast &&
    seekSecondsForNextChapter(podcastChapters, npCurrentTimeSeconds) != null;

  /*
   * The chapter table inside the file, for a book that is one file.
   *
   * Read once per book and cached, since walking to an moov that sits behind the audio takes a few
   * round trips and the bar asks about chapters several times a second.
   */
  const embeddedChapters = useAudiobookChapters({
    envelopeId: npEnvelope?.envelopeId,
    url: npEnvelope?.url,
    mimeType: npEnvelope?.mimeType,
    title: npEnvelope?.title,
    // Only where a book is genuinely one file. A multi-file book plays a chapter per track and
    // has nothing to gain from opening each of them.
    enabled: isAnyAudiobookEnvelopeId(npEnvelope?.envelopeId) && playQueue.length < 2,
  });

  /*
   * Chapters found by listening, for a book that states none.
   *
   * Offered only where the file itself has nothing to say — a book that carries a chapter table is
   * telling the truth about itself, and inferring over the top of that would replace fact with
   * guesswork. Never runs on its own: decoding thirty hours is minutes of work and real battery.
   */
  const scannedChapters = useBookChapterScan({
    bookId: npEnvelope?.envelopeId,
    uri: npEnvelope?.url,
    enabled:
      isAnyAudiobookEnvelopeId(npEnvelope?.envelopeId) &&
      playQueue.length < 2 &&
      embeddedChapters.length < 2,
  });

  /**
   * The marks the bar should use: the book's own where it has them, otherwise what was heard.
   *
   * Ordered, not merged. A file that states its chapters is authoritative and a scan is inference,
   * so the two are never mixed — mixing them would put a guessed mark between two stated ones and
   * leave nothing on screen to say which was which.
   */
  const bookChapterMarks =
    embeddedChapters.length > 1 ? embeddedChapters : scannedChapters.marks;

  /**
   * The chapter to scope the seek bar to, when there is one.
   *
   * Two shapes reach this, and they are genuinely different:
   *
   *   A podcast episode is one file with chapter offsets inside it, so the window is a real slice
   *   of that file and a scrub inside it is a scrub inside the episode.
   *
   *   A book held as one file per chapter is already playing only the chapter, so its window
   *   starts at zero and spans the track. Nothing about seeking changes; what it adds is knowing
   *   this is chapter six of forty-one with eleven hours left, which the player never said.
   *
   *   A single M4B carries its chapter table inside the file, so it is the first case again: real
   *   offsets, a real slice, a scrub that lands where it says. This is the shape the whole idea
   *   was for — one file, fourteen hours — and until embeddedChapters existed it was the one shape
   *   that could not be served, because nothing carried the parsed atoms to playback.
   */
  const nowPlayingChapterWindow = useMemo(() => {
    if (npIsPodcast) {
      return resolveChapterWindow({
        positionSeconds: npCurrentTimeSeconds,
        durationSeconds: npDurationSeconds,
        chapters: podcastChapters as ChapterMark[],
      });
    }
    // The book's own chapter table wins over anything derived from how its files are arranged.
    if (bookChapterMarks.length > 1) {
      const window = resolveChapterWindow({
        positionSeconds: npCurrentTimeSeconds,
        durationSeconds: npDurationSeconds,
        chapters: bookChapterMarks,
      });
      if (window) return window;
    }
    if (!isAnyAudiobookEnvelopeId(npEnvelope?.envelopeId) || playQueue.length < 2) return null;
    const trackLength = npDurationSeconds > 0 ? npDurationSeconds : 0;
    if (trackLength <= 0) return null;
    // Every chapter's length, so "how much of the book is left" is a sum and not a guess.
    const lengths = playQueue.map((item, index) =>
      index === queueIndex ? trackLength : Math.max(0, item.durationSeconds ?? 0),
    );
    const bookSeconds = lengths.reduce((sum, length) => sum + length, 0);
    const before = lengths.slice(0, queueIndex).reduce((sum, length) => sum + length, 0);
    const played = before + Math.min(trackLength, Math.max(0, npCurrentTimeSeconds));
    return {
      index: queueIndex,
      count: playQueue.length,
      title: '',
      startSeconds: 0,
      durationSeconds: trackLength,
      positionSeconds: Math.min(trackLength, Math.max(0, npCurrentTimeSeconds)),
      remainingSeconds: Math.max(0, trackLength - npCurrentTimeSeconds),
      // Zero where a chapter reported no length, since a percentage of an unknown total is a
      // number that looks true and is not.
      overallPercent: bookSeconds > 0 ? Math.min(100, (played / bookSeconds) * 100) : 0,
      overallRemainingSeconds: bookSeconds > 0 ? Math.max(0, bookSeconds - played) : 0,
    };
  }, [
    npIsPodcast,
    podcastChapters,
    bookChapterMarks,
    npCurrentTimeSeconds,
    npDurationSeconds,
    npEnvelope,
    playQueue,
    queueIndex,
  ]);

  /**
   * Only non-null while the screen is holding a still-audible track through another track's
   * resolve. The bar derives identity from the audio layer otherwise, and the audio layer has
   * already moved on.
   */
  const playerBarHeldNowPlaying = useMemo(
    () =>
      nowPlayingAuthority.source === 'held'
        ? {
            title: homeTitle,
            artist: homeArtist,
            album: homeAlbum,
            envelope: authoritativeEnvelope,
            positionSeconds: npCurrentTimeSeconds,
            durationSeconds: npDurationSeconds,
          }
        : null,
    [
      nowPlayingAuthority.source,
      homeTitle,
      homeArtist,
      homeAlbum,
      authoritativeEnvelope,
      npCurrentTimeSeconds,
      npDurationSeconds,
    ],
  );

  return {
    npCurrentTimeSeconds,
    npDurationSeconds,
    npIsPlaying,
    npEnvelope,
    npIsPodcast,
    npIsBusy,
    activePodcastChapter,
    canPodcastPrevChapter,
    canPodcastNextChapter,
    embeddedChapters,
    scannedChapters,
    bookChapterMarks,
    nowPlayingChapterWindow,
    playerBarHeldNowPlaying,
  };
}

/** ---- 3. togglePlay ---------------------------------------------------------------------------- */

export type ShellTogglePlayArgs = {
  serverStemMix: ServerStemMixState;
  isConnectRemoteRef: MutableRefObject<boolean>;
  remoteMirror: SyncStatePayload | null;
  sendConnectCommand: (command: ConnectCommand) => void;
  audio: UseAudioFSMResult;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  persistLockerPlayRepair: (tapped: MediaEnvelope, playable: MediaEnvelope) => void;
};

export function useShellTogglePlay({
  serverStemMix,
  isConnectRemoteRef,
  remoteMirror,
  sendConnectCommand,
  audio,
  showAppToast,
  t,
  persistLockerPlayRepair,
}: ShellTogglePlayArgs) {
  const togglePlay = useCallback(() => {
    if (serverStemMix.stemMixActive) {
      serverStemMix.toggleStemPlayback();
      return;
    }
    if (isConnectRemoteRef.current) {
      if (remoteMirror?.isPlaying) sendConnectCommand({ cmd: 'PAUSE' });
      else if (remoteMirror?.currentTrackId) {
        sendConnectCommand({ cmd: 'PLAY', envelopeId: remoteMirror.currentTrackId });
      }
      return;
    }
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) {
      audio.pause();
      return;
    }
    void (async () => {
      const env = audio.envelope;
      if (env && shouldRunLockerPlaybackGate(env)) {
        const locker = await ensureLockerPlayable(env);
        if (locker.kind === 'missing-audio') {
          if (
            env &&
            (await attemptDeadLockerReacquire(env.title, env.artist, env.album))
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                title: env.title,
              }),
              5000,
            );
            return;
          }
          showAppToast(
            t('player.lockerAudioMissing', {
              defaultValue:
                'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
            }),
            6000,
          );
          return;
        }
        if (locker.kind === 'playable') {
          const playable = preserveTappedEnvelopeIdentity(env, locker.envelope);
          persistLockerPlayRepair(env, playable);
          if (
            playable.url !== env.url?.trim() ||
            playable.sourceId !== env.sourceId
          ) {
            audio.primePlaybackGesture();
            audio.loadEnvelope(playable, { autoPlay: true, instant: true });
            return;
          }
        }
      }
      audio.primePlaybackGesture();
      await audio.play({ userGesture: true });
    })();
  }, [audio, remoteMirror, sendConnectCommand, serverStemMix, showAppToast, t]);

  return { togglePlay };
}
