/**
 * Sandbox Music — Layer 1: State & Audio Engine
 * Profile system (local, no sign-up) + HTMLAudioElement FSM.
 * UI layers consume these hooks only; no UI in this module.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  catalogTrackPlaybackEndReached,
  catalogPlaybackDisplayPosition,
  resolveCatalogAwareDuration,
} from './catalogPlaybackDuration';
import { isCatalogPreviewUrl, needsDirectElementOutput } from './displaySanitize';
import { isPlayIntentCurrent, currentPlayGeneration } from './playIntent';
import { configureAndroidAudioSession } from './backgroundMedia';
import {
  initNativeExoPlaybackEvents,
  isAndroidNativePlaybackLikely,
  mapNativeExoStateToFsm,
  nativeExoPause,
  nativeExoPlayUrl,
  nativeExoPlaybackStatus,
  nativeExoResume,
  nativeExoSeek,
  nativeExoUpdateTrackMetadata,
  nativeExoStop,
  nativeExoEnqueueNext,
  nativeExoSetGaplessEnabled,
  nativeExoSetReplayGainDb,
  nativeExoSetUserVolume,
  nativeExoSetPlaybackSpeed,
  syncNativeExoPlaybackPrefs,
  prepareNativeExoPlayback,
  shouldPreferAndroidNativePlayback,
  subscribeNativeExoStatus,
  teardownNativeExoPlaybackEvents,
  type NativeExoPlayMetadata,
} from './androidNativePlayback';
import {
  loadAndroidNativePlaybackEnabled,
  loadAndroidWebViewCrossfadeEnabled,
} from './androidNativePlaybackSettings';
import { resolveNativeExoTransitionPrefs } from './androidWiredDacPlayback';
import {
  mapNativeStateToFsm,
  nativePause,
  nativePlayUrl,
  nativePlaybackStatus,
  nativeResume,
  nativeSeek,
  nativeStop,
  shouldUseNativeAudiophile,
} from './nativeAudiophile';
import { resolveNativeExoStreamUrlAsync } from './nativeExoStreamResolver';
import {
  effectiveNativeExoState,
  isNativeExoAudible,
  nativeExoUiIsPlaying,
  nativeExoCanResumeSameTrack,
  nativeStatusMatchesEnvelope,
  reconcileEnvelopeFromNativeStatus,
  reconcileNativeExoPosition,
  resolvePauseHoldPos,
  synthesizeNativeExoPosition,
  saveLastPlayIntent,
} from './lastPlayIntent';
import { PlaybackCrossfadeRouter } from './playbackCrossfade';
import { updatePlaybackDiagnostics } from './playbackDiagnostics';
import { computePlaybackGainDb, resolveEnvelopeReplayGainDb } from './replayGainPlayback';
import {
  loadCrossfadeEnabled,
  loadGaplessEnabled,
  getPlaybackVolumeCap,
  loadPlaybackVolume,
  savePlaybackVolume,
} from './sandboxSettings';
import { isPodcastEnvelopeId, parsePodcastEpisodeId, parsePodcastFeedId } from './podcastStorage';
import { loadEpisodeVolumeBoostDb } from './podcastEpisodeBoost';
import {
  PODCAST_PLAYBACK_REFRESH_EVENT,
  PODCAST_SETTINGS_CHANGE_EVENT,
} from './podcastSettings';
import { podcastWebAudioEffectsRequired } from './podcastVoiceBoost';
import { resolvePodcastWebAudioStreamUrl, unwrapPodcastProxyUrl } from './podcastPlayback';
import { playbackSwitchRequiresHardPreempt } from './playbackSession';

// =============================================================================
// DATA STRUCTURES
// =============================================================================

/** Where resolved bytes or metadata originated. */
export type MediaProvider =
  | 'local-vault'
  | 'stream-cache'
  | 'indexeddb'
  | 'blob'
  | 'http'
  | 'https'
  | 'dht-swarm'
  | 'hls'
  | 'gemini-curate'
  | 'archive-org'
  | 'jamendo'
  | 'stream-proxy'
  | 'proxy'
  | 'debrid'
  | 'webtorrent'
  | 'ipfs'
  | 'soulseek'
  | 'unknown';

/** How the browser should attach playback to the audio element. */
export type MediaTransport =
  | 'element-src'
  | 'mediasource'
  | 'webaudio-buffer'
  | 'stream-proxy'
  | 'proxy'
  | 'debrid'
  | 'p2p';

/**
 * A single resolvable origin for a track. Resolution picks the lowest `priority`
 * (0 = best) among sources that pass validation and produce a playable URL.
 */
export interface CandidateSource {
  /** Stable id for this candidate within an envelope resolve pass. */
  id: string;
  /** Sort key: lower values win (0 is highest preference). */
  priority: number;
  provider: MediaProvider;
  transport: MediaTransport;
  /** Remote or app-scheme URI when not using `blob`. */
  uri: string | null;
  /** Local binary payload; takes precedence over `uri` when present. */
  blob?: Blob;
  mimeType?: string;
  bitrateKbps?: number;
  /** Optional expiry (epoch ms); expired candidates are skipped. */
  expiresAt?: number;
  /** Partial metadata used when building the envelope before decode. */
  metadata?: {
    title?: string;
    artist?: string;
    album?: string;
    durationSeconds?: number;
    artworkUrl?: string;
    releaseYear?: string;
  };
  /** Opaque resolver hint (DHT CID, AcoustId, vault key, etc.). */
  resolveHint?: string;
}

/**
 * The winning, playable media packet after candidate resolution.
 * This is what the audio FSM loads into `HTMLAudioElement`.
 */
export interface MediaEnvelope {
  envelopeId: string;
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  provider: MediaProvider;
  transport: MediaTransport;
  /** Id of the `CandidateSource` that produced this envelope. */
  sourceId: string;
  mimeType?: string;
  artworkUrl?: string;
  /** Album or folder grouping label (locker uploads). */
  album?: string;
  /** Used for search ranking (newest first online). */
  releaseYear?: string;
  /** EBU-style loudness offset (dB) from locker ingest; playback-only consumption. */
  replayGainDb?: number | null;
  /** Hybrid resolution origin — informational badge in player bar. */
  resolutionSource?: 'locker' | 'cache' | 'server' | 'mobile' | 'preview';
}

export type AudioFsmState =
  | 'Idle'
  | 'Resolving'
  | 'Connecting'
  | 'Ready'
  | 'Playing'
  | 'Failed';

// =============================================================================
// PROFILE SYSTEM
// =============================================================================

const PROFILES_STORAGE_KEY = 'sandbox_music_profiles_v1';
const ACTIVE_PROFILE_ID_KEY = 'sandbox_music_active_profile_id_v1';

export interface SandboxProfile {
  id: string;
  displayName: string;
  createdAt: number;
  lastActiveAt: number;
}

function readProfiles(): SandboxProfile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SandboxProfile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeProfiles(profiles: SandboxProfile[]): void {
  localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles));
}

function readActiveProfileId(): string | null {
  return localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
}

function writeActiveProfileId(id: string | null): void {
  if (id === null) {
    localStorage.removeItem(ACTIVE_PROFILE_ID_KEY);
  } else {
    localStorage.setItem(ACTIVE_PROFILE_ID_KEY, id);
  }
}

function slugId(displayName: string): string {
  const base = displayName
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
  return `profile-${base || 'user'}-${Date.now().toString(36)}`;
}

export interface UseProfileResult {
  /** `null` until the user selects or creates a profile (System Login gate). */
  activeProfile: SandboxProfile | null;
  profiles: SandboxProfile[];
  /** True when `activeProfile === null` — app shell should show System Login. */
  requiresSystemLogin: boolean;
  enterAs: (displayName: string) => SandboxProfile;
  selectProfile: (profileId: string) => void;
  signOut: () => void;
  removeProfile: (profileId: string) => void;
  renameProfile: (profileId: string, displayName: string) => void;
}

export function useProfile(): UseProfileResult {
  const [profiles, setProfiles] = useState<SandboxProfile[]>(() => readProfiles());
  const [activeProfile, setActiveProfile] = useState<SandboxProfile | null>(() => {
    const savedId = readActiveProfileId();
    if (!savedId) return null;
    return readProfiles().find((p) => p.id === savedId) ?? null;
  });

  const persistProfiles = useCallback((next: SandboxProfile[]) => {
    setProfiles(next);
    writeProfiles(next);
  }, []);

  const activate = useCallback(
    (profile: SandboxProfile) => {
      const touched: SandboxProfile = {
        ...profile,
        lastActiveAt: Date.now(),
      };
      const next = profiles.map((p) => (p.id === touched.id ? touched : p));
      if (!next.some((p) => p.id === touched.id)) {
        next.push(touched);
      }
      persistProfiles(next);
      setActiveProfile(touched);
      writeActiveProfileId(touched.id);
    },
    [profiles, persistProfiles],
  );

  const enterAs = useCallback(
    (displayName: string): SandboxProfile => {
      const name = displayName.trim();
      if (!name) {
        throw new Error('Profile name cannot be empty');
      }
      const existing = profiles.find(
        (p) => p.displayName.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        activate(existing);
        return existing;
      }
      const created: SandboxProfile = {
        id: slugId(name),
        displayName: name,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      const next = [...profiles, created];
      persistProfiles(next);
      setActiveProfile(created);
      writeActiveProfileId(created.id);
      return created;
    },
    [profiles, persistProfiles, activate],
  );

  const selectProfile = useCallback(
    (profileId: string) => {
      const found = profiles.find((p) => p.id === profileId);
      if (!found) {
        throw new Error(`Profile not found: ${profileId}`);
      }
      activate(found);
    },
    [profiles, activate],
  );

  const signOut = useCallback(() => {
    import('./securitySettings').then(({ runGhostProtocol }) => runGhostProtocol()).catch(() => {});
    setActiveProfile(null);
    writeActiveProfileId(null);
  }, []);

  const removeProfile = useCallback(
    (profileId: string) => {
      const next = profiles.filter((p) => p.id !== profileId);
      persistProfiles(next);
      if (activeProfile?.id === profileId) {
        signOut();
      }
    },
    [profiles, activeProfile, persistProfiles, signOut],
  );

  const renameProfile = useCallback(
    (profileId: string, displayName: string) => {
      const name = displayName.trim();
      if (!name) return;
      const next = profiles.map((p) =>
        p.id === profileId ? { ...p, displayName: name } : p,
      );
      persistProfiles(next);
      if (activeProfile?.id === profileId) {
        setActiveProfile((prev) => (prev ? { ...prev, displayName: name } : null));
      }
    },
    [profiles, activeProfile, persistProfiles],
  );

  return {
    activeProfile,
    profiles,
    requiresSystemLogin: activeProfile === null,
    enterAs,
    selectProfile,
    signOut,
    removeProfile,
    renameProfile,
  };
}

// =============================================================================
// CANDIDATE RESOLUTION
// =============================================================================

function isCandidateValid(candidate: CandidateSource): boolean {
  if (candidate.expiresAt !== undefined && Date.now() > candidate.expiresAt) {
    return false;
  }
  if (candidate.blob) return true;
  if (candidate.uri && candidate.uri.trim().length > 0) return true;
  return false;
}

function resolveCandidateUrl(candidate: CandidateSource): string | null {
  if (candidate.blob) {
    return URL.createObjectURL(candidate.blob);
  }
  if (candidate.uri) return candidate.uri;
  return null;
}

export function resolveMediaEnvelope(
  candidates: CandidateSource[],
  envelopeId?: string,
): MediaEnvelope {
  const sorted = [...candidates]
    .filter(isCandidateValid)
    .sort((a, b) => a.priority - b.priority);

  if (sorted.length === 0) {
    throw new Error('No valid candidate sources to resolve');
  }

  const winner = sorted[0];
  const url = resolveCandidateUrl(winner);
  if (!url) {
    throw new Error(`Candidate ${winner.id} could not produce a playable URL`);
  }

  const meta = winner.metadata ?? {};
  return {
    envelopeId: envelopeId ?? `env-${winner.id}-${Date.now()}`,
    title: meta.title ?? 'Unknown Title',
    artist: meta.artist ?? 'Unknown Artist',
    url,
    durationSeconds: meta.durationSeconds ?? 0,
    provider: winner.provider,
    transport: winner.transport,
    sourceId: winner.id,
    mimeType: winner.mimeType,
    artworkUrl: meta.artworkUrl,
  };
}

// =============================================================================
// AUDIO FSM
// =============================================================================

function readBufferedEndSeconds(audio: HTMLAudioElement): number {
  const ranges = audio.buffered;
  if (ranges.length === 0) return 0;
  return ranges.end(ranges.length - 1);
}

export type PlayOptions = {
  /** True when the user explicitly tapped play (bypasses an active user-pause lock). */
  userGesture?: boolean;
  /** Lock-screen / notification / audio-focus resume — bypasses user-pause from system pause. */
  system?: boolean;
};

export type PauseOptions = {
  /** Becoming-noisy / headset unplug — do not auto-resume on speaker. */
  system?: boolean;
};

export interface UseAudioFSMResult {
  state: AudioFsmState;
  title: string;
  artist: string;
  url: string;
  currentTimeSeconds: number;
  durationSeconds: number;
  bufferedEndSeconds: number;
  provider: MediaProvider;
  transport: MediaTransport;
  envelope: MediaEnvelope | null;
  play: (options?: PlayOptions) => Promise<void>;
  pause: (options?: PauseOptions) => void;
  seek: (seconds: number) => void;
  /** Hold position updates while the user drags the progress slider. */
  beginScrub: () => void;
  endScrub: () => void;
  volume: number;
  isMuted: boolean;
  setVolume: (level: number) => void;
  toggleMute: () => void;
  /** Show track metadata while tier resolve runs (Resolving state, no audio yet). */
  beginResolve: (envelope: MediaEnvelope, options?: EnvelopeLoadOptions) => Promise<void>;
  /** Load a pre-resolved envelope (sets Resolving → Connecting). Returns a promise for gesture-chain awaits. */
  loadEnvelope: (envelope: MediaEnvelope, options?: EnvelopeLoadOptions) => Promise<boolean>;
  /** Resolve candidates then load the winning envelope. */
  loadFromCandidates: (
    candidates: CandidateSource[],
    envelopeId?: string,
    options?: Pick<EnvelopeLoadOptions, 'playToken' | 'playEnvelopeId'>,
  ) => Promise<void>;
  stop: () => void;
  /** Mark resolve/playback failed but keep envelope for mini player UI. */
  failResolve: () => void;
  /** Subscribe to natural track end (for gapless queue advance). */
  subscribeEnded: (listener: () => void) => () => void;
  /** Pre-decode upcoming track URL (gapless buffering). */
  prebufferUrl: (url: string | null, meta?: NativeExoPlayMetadata) => void;
  /** Await serialized native Exo enqueueNext chain (album queue priming). */
  flushNativeExoEnqueueChain: () => Promise<void>;
  /** Android ExoPlayer path active — poll + UI reconcile. */
  nativeExoActive: boolean;
  /** True when native poll coerces OEM idle/paused into audible playback. */
  nativeExoEffectivePlaying: boolean;
  /**
   * Call synchronously from a user tap/click before async tier resolve.
   * Unlocks WebView audio on Android/Capacitor where play() must start in-gesture.
   * Pass the tapped envelope so podcast→music transitions restore Exo before resolve.
   */
  primePlaybackGesture: (nextEnvelope?: MediaEnvelope) => void;
  /** Raw stream length from ExoPlayer / audio element (before catalog track clamp). */
  streamDurationSeconds: number;
  /** Swap queue track metadata and seek without stopping the current stream. */
  adoptQueueTrack: (envelope: MediaEnvelope, seekSeconds: number) => void;
  /** Re-sync JS envelope/state from native Exo after Android resume or WebView reload. */
  reconcileFromNativeExo: () => Promise<boolean>;
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;
  /** Web Audio level tap for podcast Smart Speed (null when direct/native output). */
  getPlaybackLevelAnalyser: () => AnalyserNode | null;
  /** Apply per-episode loudness boost (dB) in the Web Audio chain. */
  applyPodcastEpisodeVolumeBoostDb: (db: number) => void;
  /** Re-read podcast feed / episode boost prefs for the current envelope. */
  refreshPodcastPlaybackChain: () => void;
}

export type EnvelopeLoadOptions = {
  /** When false, attach track but stay paused (queue restore). Default true. */
  autoPlay?: boolean;
  /** Skip Resolving flash when swapping URL on an already-active track. */
  seamless?: boolean;
  /** Prefer a prebuffered element when URL matches (cache / prefetch hit). */
  instant?: boolean;
  /** Play-tap generation — stale async loads are ignored when mismatched. */
  playToken?: number;
  /** Envelope id from the user tap — must match for load to apply. */
  playEnvelopeId?: string;
};

function playbackUrlsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
}

function isStalePlayLoad(
  next: MediaEnvelope,
  options?: EnvelopeLoadOptions,
): boolean {
  if (options?.playToken == null) return false;
  return !isPlayIntentCurrent(options.playToken, options.playEnvelopeId ?? next.envelopeId);
}

/** Locker / content:// playback must route through Exo on Android — not WebView blob audio. */
function envelopeNeedsAndroidNativeExo(env: MediaEnvelope, url: string): boolean {
  if (!isAndroidNativePlaybackLikely()) return false;
  if (podcastWebAudioEffectsRequired(env.envelopeId)) return false;
  if (env.provider === 'local-vault') return true;
  return /^content:\/\//i.test(url) || /^file:\/\//i.test(url);
}

/** Minimal silent WAV — unlocks mobile WebView audio during the user-gesture window. */
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function useAudioFSM(): UseAudioFSMResult {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const pendingAutoPlayRef = useRef(false);
  const userPausedRef = useRef(false);
  const systemPauseRef = useRef(false);
  const userPauseHoldPosRef = useRef(0);
  const latestDisplayPosRef = useRef(0);
  const pauseCooldownUntilRef = useRef(0);
  const lastTransportToggleAtRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const envelopeRef = useRef<MediaEnvelope | null>(null);
  const crossfadeRef = useRef(new PlaybackCrossfadeRouter());
  const syncPodcastPlaybackChain = useCallback((envelopeId: string) => {
    const isPod = isPodcastEnvelopeId(envelopeId);
    crossfadeRef.current.setPodcastPlayback(isPod);
    if (!isPod) {
      crossfadeRef.current.setPodcastFeedId(null);
      crossfadeRef.current.setPodcastEpisodeVolumeBoostDb(0);
      return;
    }
    crossfadeRef.current.setPodcastFeedId(parsePodcastFeedId(envelopeId));
    const episodeId = parsePodcastEpisodeId(envelopeId);
    crossfadeRef.current.setPodcastEpisodeVolumeBoostDb(
      episodeId ? loadEpisodeVolumeBoostDb(episodeId) : 0,
    );
  }, []);
  const endedListenersRef = useRef(new Set<() => void>());
  const prebufferRef = useRef<HTMLAudioElement | null>(null);
  const nativeExoLastPrebufferRef = useRef<string | null>(null);
  const sessionReplayGainDbRef = useRef(0);
  const nativeAudiophileRef = useRef(false);
  /** Optimistic ON on Android so first tap does not fall through to broken WebView blob playback. */
  const nativeExoRef = useRef(isAndroidNativePlaybackLikely());
  const nativeEndedRef = useRef(false);
  const nativeExoEndedRef = useRef(false);
  const nativeExoTruncatedHealRef = useRef(false);
  const catalogTrackEndFiredRef = useRef(false);
  const nativeExoQueueAheadRef = useRef(false);
  /** Serialize native Exo enqueueNext so album order is preserved under async prefetch. */
  const nativeExoEnqueueChainRef = useRef<Promise<void>>(Promise.resolve());
  const nativeExoLastPosRef = useRef(0);
  const lastRenderedExoPosRef = useRef(0);
  /** While set, ignore native position polls until the new track is confirmed loaded. */
  const exoAwaitingEnvelopeIdRef = useRef<string | null>(null);
  const nativeExoStuckResumeAtRef = useRef(0);
  const userSeekedAtRef = useRef(0);
  const userScrubbingRef = useRef(false);
  const lastNativePlayingAtRef = useRef(0);
  const exoPlaybackAnchorRef = useRef<{ pos: number; atMs: number } | null>(null);
  const tryResumeNativeExoSameTrackRef = useRef<() => Promise<boolean>>(async () => false);
  const unbindAudioRef = useRef<(() => void) | null>(null);

  const resetForNewTrack = useCallback(
    (
      next: MediaEnvelope,
      opts?: { clearPause?: boolean; setAwaiting?: boolean },
    ) => {
      const clearPause = opts?.clearPause !== false;
      setCurrentTimeSeconds(0);
      nativeExoLastPosRef.current = 0;
      lastRenderedExoPosRef.current = 0;
      latestDisplayPosRef.current = 0;
      userPauseHoldPosRef.current = 0;
      exoPlaybackAnchorRef.current = null;
      setStreamDurationSeconds(0);
      if (opts?.setAwaiting !== false) {
        exoAwaitingEnvelopeIdRef.current = next.envelopeId;
      }
      if (clearPause) {
        userPausedRef.current = false;
        pauseCooldownUntilRef.current = 0;
      }
    },
    [],
  );

  const [nativeAudiophileActive, setNativeAudiophileActive] = useState(false);
  const [nativeExoActive, setNativeExoActive] = useState(isAndroidNativePlaybackLikely());
  const [nativeExoEffectivePlaying, setNativeExoEffectivePlaying] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void shouldUseNativeAudiophile().then((audiophile) => {
        nativeAudiophileRef.current = audiophile;
        setNativeAudiophileActive(audiophile);
        if (audiophile) {
          nativeExoRef.current = false;
          setNativeExoActive(false);
          return;
        }
        if (isAndroidNativePlaybackLikely()) {
          nativeExoRef.current = true;
          setNativeExoActive(true);
        }
        void shouldPreferAndroidNativePlayback().then((exo) => {
          const prefer =
            exo ||
            (isAndroidNativePlaybackLikely() &&
              loadAndroidNativePlaybackEnabled() &&
              !loadAndroidWebViewCrossfadeEnabled());
          nativeExoRef.current = prefer;
          setNativeExoActive(prefer);
          if (prefer) {
            void prepareNativeExoPlayback();
            void syncNativeExoPlaybackPrefs(resolveNativeExoTransitionPrefs());
          }
        });
      });
      crossfadeRef.current.refreshSandboxSonic();
      crossfadeRef.current.refreshPodcastVoiceBoost();
      syncPodcastPlaybackChain(envelopeRef.current?.envelopeId ?? '');
    };
    const refreshPodcastPlayback = () => {
      crossfadeRef.current.refreshPodcastVoiceBoost();
      syncPodcastPlaybackChain(envelopeRef.current?.envelopeId ?? '');
    };
    refresh();
    window.addEventListener('sandbox-settings-change', refresh);
    window.addEventListener(PODCAST_SETTINGS_CHANGE_EVENT, refreshPodcastPlayback);
    window.addEventListener(PODCAST_PLAYBACK_REFRESH_EVENT, refreshPodcastPlayback);
    window.addEventListener('sandbox-podcast-episode-boost-change', refreshPodcastPlayback);
    return () => {
      window.removeEventListener('sandbox-settings-change', refresh);
      window.removeEventListener(PODCAST_SETTINGS_CHANGE_EVENT, refreshPodcastPlayback);
      window.removeEventListener(PODCAST_PLAYBACK_REFRESH_EVENT, refreshPodcastPlayback);
      window.removeEventListener('sandbox-podcast-episode-boost-change', refreshPodcastPlayback);
    };
  }, [syncPodcastPlaybackChain]);

  const preferEnvelopeDuration = (actual: number): number => {
    const catalog = envelopeRef.current?.durationSeconds ?? 0;
    return resolveCatalogAwareDuration(actual, catalog);
  };

  const maybeFireCatalogTrackEnd = (
    positionSeconds: number,
    streamSeconds: number,
  ): void => {
    const catalog = envelopeRef.current?.durationSeconds ?? 0;
    if (
      nativeExoRef.current &&
      nativeExoQueueAheadRef.current &&
      !catalogTrackPlaybackEndReached(positionSeconds, streamSeconds, catalog)
    ) {
      return;
    }
    if (
      catalogTrackPlaybackEndReached(positionSeconds, streamSeconds, catalog) &&
      !nativeExoEndedRef.current &&
      !catalogTrackEndFiredRef.current
    ) {
      catalogTrackEndFiredRef.current = true;
      nativeExoEndedRef.current = true;
      endedListenersRef.current.forEach((fn) => fn());
    }
  };

  const [state, setState] = useState<AudioFsmState>('Idle');
  const [envelope, setEnvelope] = useState<MediaEnvelope | null>(null);
  const [currentTimeSeconds, setCurrentTimeSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [streamDurationSeconds, setStreamDurationSeconds] = useState(0);
  const [bufferedEndSeconds, setBufferedEndSeconds] = useState(0);
  const [volume, setVolumeState] = useState(loadPlaybackVolume);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const preMuteVolumeRef = useRef(1.0);

  useEffect(() => {
    crossfadeRef.current.setPlaying(state === 'Playing');
  }, [state]);

  const revokeObjectUrl = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
  }, []);

  const bindAudioElement = useCallback(
    (audio: HTMLAudioElement) => {
      unbindAudioRef.current?.();

      const onWaiting = () => {
        if (!pendingAutoPlayRef.current) return;
        setState((prev) => (prev === 'Playing' ? prev : 'Connecting'));
      };

      const tryAutoPlayFromCanPlay = () => {
        if (!pendingAutoPlayRef.current || audio.paused === false) return;
        void crossfadeRef.current.resumeContext();
        const p = audio.play();
        playPromiseRef.current = p;
        void p
          .then(() => {
            if (playPromiseRef.current === p) setState('Playing');
          })
          .catch((err) => {
            if (playPromiseRef.current !== p) return;
            console.warn('[useAudioFSM] autoplay retry on canplay failed:', err);
            pendingAutoPlayRef.current = false;
            setState('Failed');
          });
      };

      const onCanPlay = () => {
        const rawDur = Number.isFinite(audio.duration) ? audio.duration : 0;
        if (rawDur > 0) setStreamDurationSeconds(rawDur);
        const dur = rawDur > 0 ? preferEnvelopeDuration(rawDur) : 0;
        setDurationSeconds(dur);
        setBufferedEndSeconds(readBufferedEndSeconds(audio));
        setState((prev) => {
          if (prev === 'Playing') return prev;
          if (pendingAutoPlayRef.current && prev === 'Connecting') {
            tryAutoPlayFromCanPlay();
            return prev;
          }
          return 'Ready';
        });
      };

      const onPlaying = () => setState('Playing');

      const onPause = () => {
        if (audio.ended) return;
        setState((prev) =>
          prev === 'Playing' || prev === 'Connecting' ? 'Ready' : prev,
        );
      };

      const onError = () => {
        pendingAutoPlayRef.current = false;
        const code = audio.error?.code;
        const msg = audio.error?.message ?? 'unknown';
        console.warn('[useAudioFSM] media element error:', code, msg, audio.src?.slice(0, 120));
        setState('Failed');
      };

      const onStalled = () => {
        if (!pendingAutoPlayRef.current) return;
        console.warn('[useAudioFSM] media stalled while connecting:', audio.src?.slice(0, 120));
      };

      const onTimeUpdate = () => {
        if (
          userScrubbingRef.current ||
          nativeExoRef.current ||
          nativeAudiophileRef.current
        ) {
          return;
        }
        setCurrentTimeSeconds(audio.currentTime);
        setBufferedEndSeconds(readBufferedEndSeconds(audio));
        if (Number.isFinite(audio.duration) && audio.duration > 0) {
          setDurationSeconds(preferEnvelopeDuration(audio.duration));
          maybeFireCatalogTrackEnd(audio.currentTime, audio.duration);
        }
      };

      const onProgress = () => {
        setBufferedEndSeconds(readBufferedEndSeconds(audio));
      };

      const onLoadedMetadata = () => {
        if (Number.isFinite(audio.duration)) {
          setDurationSeconds(preferEnvelopeDuration(audio.duration));
        }
      };

      const onEnded = () => {
        endedListenersRef.current.forEach((fn) => fn());
      };

      audio.addEventListener('waiting', onWaiting);
      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('error', onError);
      audio.addEventListener('stalled', onStalled);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('progress', onProgress);
      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('ended', onEnded);

      unbindAudioRef.current = () => {
        audio.removeEventListener('waiting', onWaiting);
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('error', onError);
        audio.removeEventListener('stalled', onStalled);
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('progress', onProgress);
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('ended', onEnded);
      };
    },
    [],
  );

  const replaceAudioElement = useCallback((): HTMLAudioElement => {
    const old = audioRef.current;
    if (old) {
      old.pause();
      old.removeAttribute('src');
      old.load();
    }
    unbindAudioRef.current?.();
    unbindAudioRef.current = null;
    crossfadeRef.current.detach();

    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 1.0;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.muted = false;
    audioRef.current = audio;
    bindAudioElement(audio);
    return audio;
  }, [bindAudioElement]);

  const resetNativeExoEnqueueChain = useCallback(() => {
    nativeExoEnqueueChainRef.current = Promise.resolve();
    nativeExoLastPrebufferRef.current = null;
  }, []);

  const flushNativeExoEnqueueChain = useCallback(async (): Promise<void> => {
    await nativeExoEnqueueChainRef.current;
  }, []);

  /** Desktop/WebView gapless: hidden HTMLAudioElement preloads the next queue URL. */
  const prebufferUrl = useCallback((url: string | null, meta?: NativeExoPlayMetadata) => {
    if (!url?.trim()) {
      resetNativeExoEnqueueChain();
      if (prebufferRef.current) {
        prebufferRef.current.removeAttribute('src');
        prebufferRef.current.load();
      }
      return;
    }
    const exoTransition = resolveNativeExoTransitionPrefs();
    const useNativeExoQueue = nativeExoRef.current;
    if (useNativeExoQueue) {
      if (nativeExoLastPrebufferRef.current === url) return;
      nativeExoLastPrebufferRef.current = url;
      if (exoTransition.gapless) {
        void nativeExoSetGaplessEnabled(true);
      }
      nativeExoEnqueueChainRef.current = nativeExoEnqueueChainRef.current
        .then(async () => {
          const envelope: MediaEnvelope = {
            envelopeId: meta?.envelopeId ?? '',
            title: meta?.title ?? '',
            artist: meta?.artist ?? '',
            album: meta?.album,
            url,
            durationSeconds: meta?.durationSeconds ?? 0,
            provider: 'stream-proxy',
            transport: 'element-src',
            sourceId: meta?.envelopeId,
            artworkUrl: meta?.artworkUrl,
          };
          const exoUrl = (await resolveNativeExoStreamUrlAsync(envelope)) ?? url;
          if (
            exoUrl &&
            (/^https?:\/\//i.test(exoUrl) ||
              /^content:\/\//i.test(exoUrl) ||
              /^file:\/\//i.test(exoUrl))
          ) {
            await nativeExoEnqueueNext(exoUrl, {
              replayGainDb: undefined,
              title: meta?.title,
              artist: meta?.artist,
              album: meta?.album,
              artworkUrl: meta?.artworkUrl,
              envelopeId: meta?.envelopeId,
              durationSeconds: meta?.durationSeconds,
            });
          }
        })
        .catch(() => undefined);
      return;
    }
    if (!prebufferRef.current) {
      prebufferRef.current = new Audio();
      prebufferRef.current.preload = 'auto';
      prebufferRef.current.setAttribute('playsinline', '');
      prebufferRef.current.setAttribute('webkit-playsinline', '');
    }
    const pre = prebufferRef.current;
    if (!playbackUrlsMatch(pre.src, url)) {
      pre.removeAttribute('crossorigin');
      if (/^https?:\/\//i.test(url)) {
        pre.crossOrigin = 'anonymous';
      }
      pre.src = url;
      pre.load();
    }
  }, [resetNativeExoEnqueueChain]);

  const tryPromotePrebuffer = useCallback(
    (url: string): HTMLAudioElement | null => {
      const pre = prebufferRef.current;
      if (!pre?.src?.trim() || !playbackUrlsMatch(pre.src, url)) return null;
      if (pre.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return null;

      const old = audioRef.current;
      if (old && old !== pre) {
        old.pause();
        unbindAudioRef.current?.();
      }
      crossfadeRef.current.detach();

      prebufferRef.current = null;
      audioRef.current = pre;
      bindAudioElement(pre);
      return pre;
    },
    [bindAudioElement],
  );

  const attachEnvelope = useCallback(
    async (next: MediaEnvelope, options?: EnvelopeLoadOptions) => {
      let audio = audioRef.current;
      if (!audio) return;
      if (isStalePlayLoad(next, options)) {
        if (envelopeRef.current?.envelopeId === next.envelopeId) {
          pendingAutoPlayRef.current = false;
        }
        console.warn('[useAudioFSM] stale play load ignored', next.envelopeId);
        return;
      }

      const shouldAutoPlay = options?.autoPlay !== false;
      syncPodcastPlaybackChain(next.envelopeId);
      const playableUrl = next.url?.trim() ?? '';
      const lockerNeedsNativeExo =
        !nativeAudiophileRef.current && envelopeNeedsAndroidNativeExo(next, playableUrl);
      if (lockerNeedsNativeExo && !nativeExoRef.current) {
        nativeExoRef.current = true;
        setNativeExoActive(true);
        void prepareNativeExoPlayback();
        void syncNativeExoPlaybackPrefs(resolveNativeExoTransitionPrefs());
      }
      if (!playableUrl) {
        pendingAutoPlayRef.current = false;
        envelopeRef.current = next;
        setEnvelope(next);
        setCurrentTimeSeconds(0);
        setDurationSeconds(next.durationSeconds);
        setState('Failed');
        return;
      }

      let resolvedPlayableUrl = playableUrl;
      if (podcastWebAudioEffectsRequired(next.envelopeId)) {
        try {
          resolvedPlayableUrl = await resolvePodcastWebAudioStreamUrl(playableUrl);
        } catch (err) {
          console.warn('[useAudioFSM] podcast web audio URL resolve failed, using direct:', err);
          resolvedPlayableUrl = unwrapPodcastProxyUrl(playableUrl) || playableUrl;
        }
        if (isStalePlayLoad(next, options)) return;
      }

      if (nativeAudiophileRef.current) {
        const replayGainDb = await resolveEnvelopeReplayGainDb(next);
        if (isStalePlayLoad(next, options)) return;
        sessionReplayGainDbRef.current = replayGainDb;
        updatePlaybackDiagnostics({ envelopeId: next.envelopeId });

        revokeObjectUrl();
        if (next.url.startsWith('blob:') && next.provider !== 'local-vault') {
          objectUrlRef.current = next.url;
        }

        envelopeRef.current = next;
        setEnvelope(next);
        setCurrentTimeSeconds(0);
        setDurationSeconds(next.durationSeconds);
        setState('Connecting');
        pendingAutoPlayRef.current = shouldAutoPlay;
        nativeEndedRef.current = false;

        audio.pause();
        audio.removeAttribute('src');
        audio.load();

        try {
          if (/^https?:\/\//i.test(playableUrl)) {
            await nativePlayUrl(playableUrl);
            if (!shouldAutoPlay) {
              await nativePause();
              setState('Ready');
            }
            return;
          }
          console.warn(
            '[useAudioFSM] audiophile mode requires HTTP(S) stream URL; falling back to Web Audio',
          );
        } catch (err) {
          console.warn('[useAudioFSM] native play failed:', err);
          setState('Failed');
          return;
        }
      }

      if (nativeExoRef.current && !podcastWebAudioEffectsRequired(next.envelopeId)) {
        const initialReplayGainRaw =
          next.replayGainDb != null && Number.isFinite(next.replayGainDb)
            ? next.replayGainDb
            : undefined;
        const initialReplayGain =
          initialReplayGainRaw != null
            ? computePlaybackGainDb(initialReplayGainRaw)
            : undefined;
        sessionReplayGainDbRef.current = initialReplayGainRaw;
        updatePlaybackDiagnostics({ envelopeId: next.envelopeId });
        setNativeExoActive(true);

        const priorEnvelopeId = envelopeRef.current?.envelopeId;
        const sameTrack = priorEnvelopeId === next.envelopeId;
        const useNativeCrossfade = resolveNativeExoTransitionPrefs().crossfade;
        if (sameTrack && options?.seamless !== false) {
          const resumed = await tryResumeNativeExoSameTrackRef.current();
          if (isStalePlayLoad(next, options)) return;
          if (resumed) {
            if (options?.autoPlay === false) {
              await nativeExoPause();
              setState('Ready');
            }
            return;
          }
        }

        envelopeRef.current = next;
        setEnvelope(next);
        saveLastPlayIntent(next);
        if (!sameTrack) {
          resetForNewTrack(next, { clearPause: shouldAutoPlay });
        }
        setDurationSeconds(next.durationSeconds);
        setState('Connecting');
        pendingAutoPlayRef.current = shouldAutoPlay;
        nativeExoEndedRef.current = false;
        nativeExoTruncatedHealRef.current = false;
        catalogTrackEndFiredRef.current = false;

        audio.pause();
        audio.removeAttribute('src');
        audio.load();

        try {
          const gaplessOn = resolveNativeExoTransitionPrefs().gapless;
          const seamlessHandoff = options?.seamless === true;
          if (priorEnvelopeId && priorEnvelopeId !== next.envelopeId && !useNativeCrossfade) {
            if (!gaplessOn || !seamlessHandoff) {
              await nativeExoStop();
              if (isStalePlayLoad(next, options)) return;
            }
          }
          const exoUrl = (await resolveNativeExoStreamUrlAsync(next)) ?? playableUrl;
          if (isStalePlayLoad(next, options)) return;
          if (
            /^https?:\/\//i.test(exoUrl) ||
            /^content:\/\//i.test(exoUrl) ||
            /^file:\/\//i.test(exoUrl)
          ) {
            if (gaplessOn) {
              await nativeExoSetGaplessEnabled(true);
              const status = await nativeExoPlaybackStatus();
              if (status.currentUrl === exoUrl && sameTrack) {
                if (shouldAutoPlay) {
                  if (status.state !== 'playing') {
                    await nativeExoResume();
                    const again = await nativeExoPlaybackStatus();
                    setState(again.state === 'playing' ? 'Playing' : 'Connecting');
                    return;
                  }
                  setState('Playing');
                } else {
                  await nativeExoPause();
                  setState('Ready');
                }
                return;
              }
            }
            const keepGaplessQueue = gaplessOn && seamlessHandoff;
            console.log(
              `[useAudioFSM] nativeExoPlayUrl ${JSON.stringify({
                title: next.title,
                urlKind: exoUrl.startsWith('content://')
                  ? 'content'
                  : exoUrl.startsWith('file://')
                    ? 'file'
                    : /youtube\.com|youtu\.be/i.test(exoUrl)
                    ? 'watch'
                    : /googlevideo/i.test(exoUrl)
                      ? 'cdn'
                      : 'http',
                urlLen: exoUrl.length,
                autoPlay: shouldAutoPlay,
              })}`,
            );
            if (!keepGaplessQueue) {
              resetNativeExoEnqueueChain();
            }
            await nativeExoPlayUrl(exoUrl, {
              autoPlay: shouldAutoPlay,
              replayGainDb: initialReplayGain,
              resetQueue: !keepGaplessQueue,
              gaplessEnabled: gaplessOn,
              crossfade:
                useNativeCrossfade &&
                !!priorEnvelopeId &&
                priorEnvelopeId !== next.envelopeId,
              envelopeId: next.envelopeId,
              title: next.title,
              artist: next.artist,
              album: next.album,
              artworkUrl: next.artworkUrl,
              durationSeconds: next.durationSeconds,
            });
            if (initialReplayGainRaw == null) {
              void resolveEnvelopeReplayGainDb(next).then((replayGainDb) => {
                if (isStalePlayLoad(next, options)) return;
                sessionReplayGainDbRef.current = replayGainDb;
                const gainDb = computePlaybackGainDb(replayGainDb);
                updatePlaybackDiagnostics({ envelopeId: next.envelopeId, replayGainDb: gainDb });
                void nativeExoSetReplayGainDb(gainDb);
              });
            }
            if (isStalePlayLoad(next, options)) return;
            if (shouldAutoPlay) {
              window.setTimeout(() => {
                void (async () => {
                  try {
                    const s = await nativeExoPlaybackStatus();
                    if (s.state === 'paused' || s.state === 'idle' || s.state === 'loading') {
                      await nativeExoResume();
                      await new Promise((r) => window.setTimeout(r, 500));
                      const again = await nativeExoPlaybackStatus();
                      if (again.state !== 'playing') {
                        await nativeExoResume();
                      }
                    }
                  } catch {
                    /* optional */
                  }
                })();
              }, 500);
            }
            const status = await nativeExoPlaybackStatus();
            if ((status.durationSecs ?? 0) > 0) {
              setDurationSeconds(preferEnvelopeDuration(status.durationSecs ?? 0));
            }
            if (!sameTrack) {
              // playUrl already seekTo(index, 0) + play(); seeking again restarts decode and
              // can repeat the intro when status polls race ahead of UI refs.
              setCurrentTimeSeconds(0);
              nativeExoLastPosRef.current = 0;
              lastRenderedExoPosRef.current = 0;
              exoPlaybackAnchorRef.current = null;
              const nativeId = status.envelopeId?.trim();
              if (nativeId === next.envelopeId) {
                exoAwaitingEnvelopeIdRef.current = null;
              }
            } else if ((status.positionSecs ?? 0) > 0) {
              setCurrentTimeSeconds(status.positionSecs ?? 0);
            }
            if (shouldAutoPlay) {
              const initialEffective = effectiveNativeExoState(
                status,
                nativeExoLastPosRef.current,
              );
              if (initialEffective === 'playing') {
                setState('Playing');
                setNativeExoEffectivePlaying(true);
              } else if (status.state === 'loading' || status.state === 'idle') {
                setState('Connecting');
                try {
                  await nativeExoResume();
                  const again = await nativeExoPlaybackStatus();
                  const againEffective = effectiveNativeExoState(
                    again,
                    status.positionSecs ?? 0,
                  );
                  setState(againEffective === 'playing' ? 'Playing' : 'Connecting');
                  setNativeExoEffectivePlaying(againEffective === 'playing');
                  if (sameTrack && (again.positionSecs ?? 0) > 0) {
                    setCurrentTimeSeconds(again.positionSecs ?? 0);
                  }
                } catch {
                  setState('Failed');
                }
              } else if (status.state === 'paused') {
                try {
                  await nativeExoResume();
                  const again = await nativeExoPlaybackStatus();
                  const againEffective = effectiveNativeExoState(
                    again,
                    status.positionSecs ?? 0,
                  );
                  setState(againEffective === 'playing' ? 'Playing' : 'Ready');
                  setNativeExoEffectivePlaying(againEffective === 'playing');
                  if (sameTrack && (again.positionSecs ?? 0) > 0) {
                    setCurrentTimeSeconds(again.positionSecs ?? 0);
                  }
                } catch {
                  setState('Ready');
                }
              } else if (status.state === 'error') {
                setState('Failed');
              } else {
                setState('Connecting');
              }
            } else {
              setState(status.state === 'paused' ? 'Ready' : 'Connecting');
            }
            return;
          }
          console.warn(
            '[useAudioFSM] ExoPlayer requires HTTP(S) or content:// stream URL; falling back to WebView audio',
          );
        } catch (err) {
          console.warn('[useAudioFSM] ExoPlayer play failed:', err);
          if (isPodcastEnvelopeId(next.envelopeId)) {
            nativeExoRef.current = false;
            setNativeExoActive(false);
            setNativeExoEffectivePlaying(false);
            await nativeExoStop();
            try {
              resolvedPlayableUrl = await resolvePodcastWebAudioStreamUrl(playableUrl);
            } catch (proxyErr) {
              console.warn('[useAudioFSM] podcast web audio proxy failed:', proxyErr);
              resolvedPlayableUrl = unwrapPodcastProxyUrl(playableUrl) || playableUrl;
            }
            if (isStalePlayLoad(next, options)) return;
          } else {
            window.dispatchEvent(
              new CustomEvent('sandbox-playback-error', {
                detail: {
                  message: err instanceof Error ? err.message : String(err),
                  url: playableUrl.slice(0, 160),
                  envelopeId: next.envelopeId,
                },
              }),
            );
            pendingAutoPlayRef.current = false;
            setState('Failed');
            return;
          }
        }
      }

      if (isAndroidNativePlaybackLikely() && playableUrl.startsWith('blob:')) {
        pendingAutoPlayRef.current = false;
        setState('Failed');
        console.warn(
          '[useAudioFSM] blob: URL could not be resolved to content:// for ExoPlayer.',
        );
        return;
      }

      if (podcastWebAudioEffectsRequired(next.envelopeId)) {
        nativeExoRef.current = false;
        setNativeExoActive(false);
        setNativeExoEffectivePlaying(false);
        void nativeExoStop();
      }

      const useDirectOutput = needsDirectElementOutput(resolvedPlayableUrl);
      if (useDirectOutput && crossfadeRef.current.hasWebAudioBinding) {
        audio = replaceAudioElement();
      }

      // Seamless queue handoff (gapless prebuffer promote): skip fadeOut wait — track may
      // already have ended and a 2.5s fade would insert audible silence on desktop Web Audio.
      const seamlessHandoff = options?.seamless === true || audio.ended === true;

      if (
        !useDirectOutput &&
        loadCrossfadeEnabled() &&
        loadGaplessEnabled() &&
        !seamlessHandoff &&
        envelopeRef.current &&
        envelopeRef.current.envelopeId !== next.envelopeId &&
        (audio.currentTime > 0 || state === 'Playing' || state === 'Ready')
      ) {
        await crossfadeRef.current.fadeOut();
      }

      updatePlaybackDiagnostics({ envelopeId: next.envelopeId });

      revokeObjectUrl();
      // Locker blob URLs are owned by lockerStorage — never revoke them here.
      if (next.url.startsWith('blob:') && next.provider !== 'local-vault') {
        objectUrlRef.current = next.url;
      }

      envelopeRef.current = next;
      setEnvelope(next);
      setCurrentTimeSeconds(0);
      setDurationSeconds(next.durationSeconds);

      const promoted =
        options?.instant !== false ? tryPromotePrebuffer(resolvedPlayableUrl) : null;
      const preloaded = promoted ?? audio;

      if (promoted) {
        pendingAutoPlayRef.current = shouldAutoPlay;
        const useDirectOutput = needsDirectElementOutput(resolvedPlayableUrl);
        const effective = isMuted ? 0 : volume;
        if (useDirectOutput) {
          crossfadeRef.current.attachDirect(preloaded, effective);
        } else {
          crossfadeRef.current.attach(preloaded, effective);
          await crossfadeRef.current.resumeContext();
        }

        if (
          shouldAutoPlay &&
          preloaded.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
        ) {
          const p = preloaded.play();
          playPromiseRef.current = p;
          void p
            .then(() => {
              if (playPromiseRef.current === p) setState('Playing');
            })
            .catch((err) => {
              if (playPromiseRef.current !== p) return;
              console.warn('[useAudioFSM] autoplay on prebuffer failed:', err);
              if (preloaded.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
                pendingAutoPlayRef.current = false;
                setState('Failed');
              }
            });
        } else if (shouldAutoPlay) {
          setState('Connecting');
          const p = preloaded.play();
          playPromiseRef.current = p;
          void p
            .then(() => {
              if (playPromiseRef.current === p) setState('Playing');
            })
            .catch(() => {
              /* onCanPlay will retry */
            });
        } else {
          setState(
            preloaded.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
              ? 'Ready'
              : 'Connecting',
          );
        }

        if (
          !useDirectOutput &&
          shouldAutoPlay &&
          loadCrossfadeEnabled() &&
          loadGaplessEnabled() &&
          !options?.seamless
        ) {
          crossfadeRef.current.fadeIn();
        }

        if (!useDirectOutput) {
          void resolveEnvelopeReplayGainDb(next).then((replayGainDb) => {
            sessionReplayGainDbRef.current = replayGainDb;
            crossfadeRef.current.setReplayGainDb(replayGainDb);
          });
        }
        return;
      }

      setState('Connecting');
      pendingAutoPlayRef.current = shouldAutoPlay;

      audio.pause();
      audio.removeAttribute('crossorigin');
      if (!useDirectOutput && /^https?:\/\//i.test(resolvedPlayableUrl)) {
        audio.crossOrigin = 'anonymous';
      }
      audio.src = resolvedPlayableUrl;
      audio.load();
      const effective = isMuted ? 0 : volume;
      if (useDirectOutput) {
        crossfadeRef.current.attachDirect(audio, effective);
      } else {
        crossfadeRef.current.attach(audio, effective);
        await crossfadeRef.current.resumeContext();
      }

      if (shouldAutoPlay) {
        if (!useDirectOutput) {
          await crossfadeRef.current.resumeContext();
        }
        const p = audio.play();
        playPromiseRef.current = p;
        void p
          .then(() => {
            if (playPromiseRef.current === p) setState('Playing');
          })
          .catch((err) => {
            if (playPromiseRef.current !== p) return;
            console.warn('[useAudioFSM] autoplay on attach failed:', err);
            // Media not ready yet — onCanPlay will retry; otherwise surface failure.
            if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
              pendingAutoPlayRef.current = false;
              setState('Failed');
            }
          });
      }

      if (
        !useDirectOutput &&
        shouldAutoPlay &&
        loadCrossfadeEnabled() &&
        loadGaplessEnabled() &&
        !options?.seamless
      ) {
        crossfadeRef.current.fadeIn();
      }

      if (!useDirectOutput) {
        void resolveEnvelopeReplayGainDb(next).then((replayGainDb) => {
          sessionReplayGainDbRef.current = replayGainDb;
          crossfadeRef.current.setReplayGainDb(replayGainDb);
        });
      }
    },
    [revokeObjectUrl, state, volume, isMuted, replaceAudioElement, tryPromotePrebuffer, resetForNewTrack],
  );

  const primePlaybackGesture = useCallback((nextEnvelope?: MediaEnvelope) => {
    pendingAutoPlayRef.current = true;
    const env = nextEnvelope ?? envelopeRef.current;
    const currentId = envelopeRef.current?.envelopeId;
    const nextId = nextEnvelope?.envelopeId;
    const hardPreempt =
      Boolean(nextEnvelope) && playbackSwitchRequiresHardPreempt(currentId, nextId);
    if (hardPreempt && nativeExoRef.current) {
      void nativeExoStop();
      nativeExoLastPosRef.current = 0;
      lastRenderedExoPosRef.current = 0;
      setNativeExoEffectivePlaying(false);
    }
    const preferNativeExo =
      isAndroidNativePlaybackLikely() &&
      !nativeAudiophileRef.current &&
      !(env && podcastWebAudioEffectsRequired(env.envelopeId));
    if (preferNativeExo) {
      nativeExoRef.current = true;
      setNativeExoActive(true);
      void configureAndroidAudioSession();
      void prepareNativeExoPlayback();
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      return;
    }
    void configureAndroidAudioSession();
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.src?.trim()) {
      audio.src = SILENT_WAV_DATA_URI;
      audio.load();
    }
    const effective = isMuted ? 0 : volume;
    if (crossfadeRef.current.usesDirectOutput || !crossfadeRef.current.hasWebAudioBinding) {
      audio.volume = effective;
    }
    void crossfadeRef.current.resumeContext();
    const p = audio.play();
    playPromiseRef.current = p;
    void p.catch(() => {
      /* expected while src is stale — loadEnvelope will retry */
    });
  }, [volume, isMuted]);

  const tryResumeNativeExoSameTrack = useCallback(async (): Promise<boolean> => {
    const env = envelopeRef.current;
    if (!env?.envelopeId?.trim() || !nativeExoRef.current) return false;
    try {
      const status = await nativeExoPlaybackStatus();
      if (!nativeExoCanResumeSameTrack(status, env.envelopeId, nativeExoLastPosRef.current)) {
        return false;
      }
      const pos = status.positionSecs ?? 0;
      const effective = effectiveNativeExoState(status, nativeExoLastPosRef.current);
      if (effective === 'playing') {
        pendingAutoPlayRef.current = true;
        userPausedRef.current = false;
        setState('Playing');
        if (pos > 0) {
          setCurrentTimeSeconds(pos);
          lastRenderedExoPosRef.current = pos;
        }
        return true;
      }
      if (status.state === 'stopped' && pos > 0) {
        const dur = status.durationSecs ?? 0;
        if (dur > 0 && pos >= dur - 1) {
          await nativeExoSeek(0);
        } else {
          await nativeExoSeek(pos);
        }
      }
      pendingAutoPlayRef.current = true;
      userPausedRef.current = false;
      await nativeExoResume();
      const again = await nativeExoPlaybackStatus();
      const againEffective = effectiveNativeExoState(again, pos);
      setState(mapNativeExoStateToFsm(againEffective));
      const againPos = again.positionSecs ?? pos;
      if (againPos > 0) {
        setCurrentTimeSeconds(againPos);
        lastRenderedExoPosRef.current = againPos;
        nativeExoLastPosRef.current = againPos;
      }
      return (
        againEffective === 'playing' ||
        againEffective === 'loading' ||
        nativeExoCanResumeSameTrack(again, env.envelopeId, pos)
      );
    } catch (err) {
      console.warn('[useAudioFSM] ExoPlayer same-track resume failed:', err);
      return false;
    }
  }, []);
  tryResumeNativeExoSameTrackRef.current = tryResumeNativeExoSameTrack;

  const guardUserTransportToggle = useCallback((): boolean => {
    const now = Date.now();
    if (now - lastTransportToggleAtRef.current < 300) return false;
    lastTransportToggleAtRef.current = now;
    return true;
  }, []);

  const play = useCallback(async (options?: PlayOptions): Promise<void> => {
    if (options?.userGesture && !guardUserTransportToggle()) {
      return;
    }
    const systemPlay = options?.system === true;
    if (options?.userGesture || systemPlay) {
      systemPauseRef.current = false;
    }
    if (systemPlay) {
      userPausedRef.current = false;
      userPauseHoldPosRef.current = 0;
      pauseCooldownUntilRef.current = 0;
    }
    if (userPausedRef.current && !options?.userGesture && !systemPlay) {
      return;
    }
    if (options?.userGesture) {
      systemPauseRef.current = false;
    }
    // Prefer refs — do not close over currentTimeSeconds or `play` identity
    // changes every Exo poll (~450ms) and re-inits wired DAC route recovery.
    const resumePos = Math.max(
      userPauseHoldPosRef.current,
      lastRenderedExoPosRef.current,
      latestDisplayPosRef.current,
    );
    userPausedRef.current = false;
    userPauseHoldPosRef.current = 0;
    pauseCooldownUntilRef.current = 0;
    exoPlaybackAnchorRef.current = {
      pos: resumePos,
      atMs: Date.now(),
    };
    if (nativeAudiophileRef.current) {
      if (state === 'Idle' || state === 'Resolving' || state === 'Failed') return;
      try {
        await nativeResume();
        setState('Playing');
      } catch (err) {
        console.warn('[useAudioFSM] native resume failed:', err);
        setState('Failed');
      }
      return;
    }

    const currentEnv = envelopeRef.current;
    if (currentEnv && !nativeAudiophileRef.current) {
      const currentUrl = currentEnv.url?.trim() ?? '';
      if (
        envelopeNeedsAndroidNativeExo(currentEnv, currentUrl) &&
        !nativeExoRef.current
      ) {
        nativeExoRef.current = true;
        setNativeExoActive(true);
        void prepareNativeExoPlayback();
        void syncNativeExoPlaybackPrefs(resolveNativeExoTransitionPrefs());
      }
    }

    if (
      nativeExoRef.current &&
      envelopeRef.current &&
      !podcastWebAudioEffectsRequired(envelopeRef.current.envelopeId)
    ) {
      const env = envelopeRef.current;
      const url = env?.url?.trim() ?? '';

      if (state === 'Resolving') {
        if (url && !isCatalogPreviewUrl(url)) {
          pendingAutoPlayRef.current = true;
          await attachEnvelope(env, {
            autoPlay: true,
            seamless: true,
            playToken: currentPlayGeneration(),
            playEnvelopeId: env.envelopeId,
          });
        }
        return;
      }

      if (state === 'Failed') {
        if (!options?.userGesture) return;
        userPausedRef.current = false;
      }

      if (state === 'Idle' || (state === 'Failed' && options?.userGesture)) {
        userPausedRef.current = false;
        if (await tryResumeNativeExoSameTrack()) return;
        if (url) {
          pendingAutoPlayRef.current = true;
          setState('Connecting');
          await attachEnvelope(env, {
            autoPlay: true,
            seamless: true,
            playToken: currentPlayGeneration(),
            playEnvelopeId: env.envelopeId,
          });
        }
        return;
      }

      userPausedRef.current = false;
      setNativeExoEffectivePlaying(true);
      if (state === 'Ready' || state === 'Connecting') {
        setState('Playing');
      }
      try {
        const holdPos = Math.max(
          resumePos,
          lastRenderedExoPosRef.current,
          latestDisplayPosRef.current,
        );
        if (holdPos > 0.5) {
          const status = await nativeExoPlaybackStatus();
          const nativePos = status.positionSecs ?? 0;
          if (nativePos + 1 < holdPos) {
            await nativeExoSeek(holdPos);
            nativeExoLastPosRef.current = holdPos;
            lastRenderedExoPosRef.current = holdPos;
            latestDisplayPosRef.current = holdPos;
          }
        }
        await nativeExoResume();
        const status = await nativeExoPlaybackStatus();
        const effective = effectiveNativeExoState(status);
        if (effective === 'idle' || effective === 'paused') {
          await nativeExoResume();
          const again = await nativeExoPlaybackStatus();
          setState(mapNativeExoStateToFsm(effectiveNativeExoState(again)));
        } else {
          setState(mapNativeExoStateToFsm(effective));
        }
        setNativeExoEffectivePlaying(true);
      } catch (err) {
        console.warn('[useAudioFSM] ExoPlayer resume failed:', err);
        setState('Failed');
        setNativeExoEffectivePlaying(false);
      }
      return;
    }

    const audio = audioRef.current;
    if (!audio || state === 'Idle' || state === 'Resolving') {
      return;
    }

    if (state === 'Failed') {
      pendingAutoPlayRef.current = true;
      setState('Connecting');
      audio.load();
      return;
    }

    await crossfadeRef.current.resumeContext();
    if (state === 'Connecting') {
      pendingAutoPlayRef.current = true;
    } else {
      setState('Connecting');
    }
    const p = audio.play();
    playPromiseRef.current = p;
    try {
      await p;
      if (playPromiseRef.current === p) {
        setState('Playing');
      }
    } catch (err) {
      if (playPromiseRef.current === p) {
        console.warn('[useAudioFSM] play() failed:', err);
        setState('Failed');
      }
    }
  }, [state, tryResumeNativeExoSameTrack, attachEnvelope, guardUserTransportToggle]);

  const displayPositionRafRef = useRef<number | null>(null);
  const pendingDisplayPosRef = useRef<number | null>(null);

  const scheduleDisplayPosition = useCallback((seconds: number, immediate = false) => {
    const clamped = Math.max(0, seconds);
    if (immediate || userScrubbingRef.current) {
      if (displayPositionRafRef.current !== null) {
        cancelAnimationFrame(displayPositionRafRef.current);
        displayPositionRafRef.current = null;
      }
      pendingDisplayPosRef.current = null;
      setCurrentTimeSeconds(clamped);
      return;
    }
    pendingDisplayPosRef.current = clamped;
    if (displayPositionRafRef.current !== null) return;
    displayPositionRafRef.current = requestAnimationFrame(() => {
      displayPositionRafRef.current = null;
      const pos = pendingDisplayPosRef.current;
      if (pos != null) setCurrentTimeSeconds(pos);
    });
  }, []);

  const commitPlaybackPosition = useCallback(
    (seconds: number) => {
      const clamped = Math.max(0, seconds);
      lastRenderedExoPosRef.current = clamped;
      latestDisplayPosRef.current = clamped;
      nativeExoLastPosRef.current = clamped;
      if (userPausedRef.current) {
        userPauseHoldPosRef.current = clamped;
      }
      scheduleDisplayPosition(clamped, true);
    },
    [scheduleDisplayPosition],
  );

  const freezePausePosition = useCallback(
    (holdPos: number) => {
      userPauseHoldPosRef.current = holdPos;
      commitPlaybackPosition(holdPos);
    },
    [commitPlaybackPosition],
  );

  const pause = useCallback((options?: PauseOptions) => {
    if (!guardUserTransportToggle()) return;

    pendingAutoPlayRef.current = false;
    lastNativePlayingAtRef.current = 0;
    setNativeExoEffectivePlaying(false);

    const systemPause = options?.system === true;
    if (systemPause) {
      systemPauseRef.current = true;
    }

    const dur =
      durationSeconds ||
      streamDurationSeconds ||
      envelopeRef.current?.durationSeconds ||
      0;

    const holdPos = resolvePauseHoldPos(dur, exoPlaybackAnchorRef.current, {
      lastRendered: lastRenderedExoPosRef.current,
      latestDisplay: latestDisplayPosRef.current,
      currentTime: currentTimeSeconds,
      nativePolled: nativeExoLastPosRef.current,
    });
    exoPlaybackAnchorRef.current = null;
    userPauseHoldPosRef.current = holdPos;
    lastRenderedExoPosRef.current = holdPos;
    latestDisplayPosRef.current = holdPos;
    nativeExoLastPosRef.current = Math.max(nativeExoLastPosRef.current, holdPos);
    setCurrentTimeSeconds(holdPos);

    userPausedRef.current = true;
    pauseCooldownUntilRef.current = Date.now() + (systemPause ? 60_000 : 1200);

    if (state === 'Playing' || state === 'Connecting') {
      setState('Ready');
    }

    if (nativeAudiophileRef.current) {
      void (async () => {
        try {
          await nativePause();
        } catch (err) {
          console.warn('[useAudioFSM] native pause failed:', err);
        }
      })();
      return;
    }

    if (nativeExoRef.current) {
      void nativeExoPause();
      void (async () => {
        try {
          if (holdPos > 0.25) {
            await nativeExoSeek(holdPos);
          }
          await nativeExoPause();
          const after = await nativeExoPlaybackStatus();
          const nativePos = after.positionSecs ?? 0;
          const lockedPos = resolvePauseHoldPos(dur, null, {
            lastRendered: holdPos,
            latestDisplay: holdPos,
            currentTime: holdPos,
            nativePolled: nativePos,
          });
          if (lockedPos > 0.25) {
            await nativeExoSeek(lockedPos);
          }
          if (effectiveNativeExoState(after, lockedPos) === 'playing') {
            await nativeExoPause();
            if (lockedPos > 0.25) {
              await nativeExoSeek(lockedPos);
            }
          }
          freezePausePosition(lockedPos);
        } catch (err) {
          console.warn('[useAudioFSM] ExoPlayer pause failed:', err);
        }
      })();
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }, [
    state,
    currentTimeSeconds,
    durationSeconds,
    streamDurationSeconds,
    freezePausePosition,
    guardUserTransportToggle,
  ]);

  const adoptQueueTrack = useCallback((next: MediaEnvelope, seekSeconds: number) => {
    pendingAutoPlayRef.current = true;
    catalogTrackEndFiredRef.current = false;
    nativeExoEndedRef.current = false;
    nativeExoTruncatedHealRef.current = false;
    exoAwaitingEnvelopeIdRef.current = null;
    envelopeRef.current = next;
    setEnvelope(next);
    saveLastPlayIntent(next);
    setDurationSeconds(next.durationSeconds ?? 0);

    const clamped = Math.max(0, seekSeconds);
    userSeekedAtRef.current = Date.now();
    lastRenderedExoPosRef.current = clamped;
    nativeExoLastPosRef.current = clamped;
    setCurrentTimeSeconds(clamped);

    if (nativeExoRef.current) {
      void nativeExoUpdateTrackMetadata({
        envelopeId: next.envelopeId,
        title: next.title,
        artist: next.artist,
        album: next.album,
        artworkUrl: next.artworkUrl,
        durationSeconds: next.durationSeconds,
      });
      void nativeExoSeek(clamped);
      setNativeExoEffectivePlaying(true);
      setState('Playing');
      return;
    }
    if (nativeAudiophileRef.current) {
      void nativeSeek(clamped);
      setState('Playing');
      return;
    }
    const audio = audioRef.current;
    if (audio && state !== 'Idle' && state !== 'Failed') {
      const cap = audio.duration || clamped;
      audio.currentTime = Math.min(clamped, cap);
      setState('Playing');
    }
  }, [state]);

  const seek = useCallback(
    (seconds: number) => {
      if (nativeAudiophileRef.current) {
        if (state === 'Idle' || state === 'Failed') return;
        const clamped = Math.max(0, Math.min(seconds, durationSeconds || seconds));
        userSeekedAtRef.current = Date.now();
        commitPlaybackPosition(clamped);
        void nativeSeek(clamped);
        return;
      }

      if (nativeExoRef.current) {
        if (state === 'Idle' || state === 'Failed') return;
        const durCap =
          streamDurationSeconds ||
          durationSeconds ||
          envelopeRef.current?.durationSeconds ||
          seconds;
        const clamped = Math.max(0, Math.min(seconds, durCap));
        userSeekedAtRef.current = Date.now();
        commitPlaybackPosition(clamped);
        void nativeExoSeek(clamped);
        return;
      }

      const audio = audioRef.current;
      if (!audio || state === 'Idle' || state === 'Failed') return;
      const clamped = Math.max(0, Math.min(seconds, audio.duration || seconds));
      userSeekedAtRef.current = Date.now();
      commitPlaybackPosition(clamped);
      audio.currentTime = clamped;
    },
    [state, durationSeconds, streamDurationSeconds, commitPlaybackPosition],
  );

  const beginScrub = useCallback(() => {
    userScrubbingRef.current = true;
  }, []);

  const endScrub = useCallback(() => {
    userScrubbingRef.current = false;
    userSeekedAtRef.current = Date.now();
  }, []);

  const applyEffectiveVolume = useCallback((level: number, muted: boolean) => {
    const effective = muted ? 0 : level;
    crossfadeRef.current.setVolume(Math.min(1, effective));
    if (nativeExoRef.current) {
      void nativeExoSetUserVolume(effective);
    }
  }, []);

  const applyPlaybackRate = useCallback((rate: number) => {
    const clamped = Math.max(0.5, Math.min(3, rate));
    const audio = audioRef.current;
    if (audio) audio.playbackRate = clamped;
    if (nativeExoRef.current) {
      void nativeExoSetPlaybackSpeed(clamped);
    }
  }, []);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const clamped = Math.max(0.5, Math.min(3, rate));
      setPlaybackRateState(clamped);
      applyPlaybackRate(clamped);
    },
    [applyPlaybackRate],
  );

  const getPlaybackLevelAnalyser = useCallback((): AnalyserNode | null => {
    return crossfadeRef.current.attachLevelMonitor();
  }, []);

  const applyPodcastEpisodeVolumeBoostDb = useCallback((db: number) => {
    crossfadeRef.current.setPodcastEpisodeVolumeBoostDb(db);
  }, []);

  const refreshPodcastPlaybackChain = useCallback(() => {
    syncPodcastPlaybackChain(envelopeRef.current?.envelopeId ?? '');
    crossfadeRef.current.refreshPodcastVoiceBoost();
  }, [syncPodcastPlaybackChain]);

  const setVolume = useCallback(
    (level: number) => {
      const cap = getPlaybackVolumeCap();
      const clamped = Math.max(0, Math.min(cap, level));
      setVolumeState(clamped);
      savePlaybackVolume(clamped);
      if (clamped > 0) {
        preMuteVolumeRef.current = clamped;
        setIsMuted(false);
        applyEffectiveVolume(clamped, false);
      } else {
        setIsMuted(true);
        applyEffectiveVolume(clamped, true);
      }
    },
    [applyEffectiveVolume],
  );

  const toggleMute = useCallback(() => {
    if (isMuted || volume === 0) {
      const restore = volume > 0 ? volume : preMuteVolumeRef.current || 1.0;
      setIsMuted(false);
      if (volume === 0) {
        setVolumeState(restore);
        savePlaybackVolume(restore);
      }
      applyEffectiveVolume(restore, false);
      return;
    }
    preMuteVolumeRef.current = volume;
    setIsMuted(true);
    applyEffectiveVolume(volume, true);
  }, [isMuted, volume, applyEffectiveVolume]);

  const subscribeEnded = useCallback((listener: () => void) => {
    endedListenersRef.current.add(listener);
    return () => endedListenersRef.current.delete(listener);
  }, []);

  const beginResolve = useCallback(async (next: MediaEnvelope, options?: EnvelopeLoadOptions) => {
    pendingAutoPlayRef.current = options?.autoPlay !== false;
    const prevId = envelopeRef.current?.envelopeId;
    const sameTrack = prevId === next.envelopeId;
    const nextUrl = next.url?.trim() ?? '';
    const needsNativeExo =
      isAndroidNativePlaybackLikely() &&
      !nativeAudiophileRef.current &&
      (envelopeNeedsAndroidNativeExo(next, nextUrl) ||
        (isPodcastEnvelopeId(next.envelopeId) &&
          !podcastWebAudioEffectsRequired(next.envelopeId)));
    if (needsNativeExo) {
      nativeExoRef.current = true;
      setNativeExoActive(true);
      void prepareNativeExoPlayback();
    }
    envelopeRef.current = next;
    setEnvelope(next);
    saveLastPlayIntent(next);
    if (!sameTrack) {
      resetForNewTrack(next, { clearPause: options?.autoPlay !== false });
    }
    setDurationSeconds(next.durationSeconds);
    setState('Resolving');
    setNativeExoEffectivePlaying(false);
    catalogTrackEndFiredRef.current = false;

    if (nativeExoRef.current && prevId !== next.envelopeId) {
      const hardPreempt = playbackSwitchRequiresHardPreempt(prevId, next.envelopeId);
      const useNativeCrossfade =
        !hardPreempt && resolveNativeExoTransitionPrefs().crossfade;
      const keepNativeGaplessQueue =
        options?.seamless === true && resolveNativeExoTransitionPrefs().gapless;
      if (!useNativeCrossfade && !keepNativeGaplessQueue) {
        void nativeExoStop();
        setNativeExoEffectivePlaying(false);
      }
    }
    if (prevId && prevId !== next.envelopeId) {
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
      crossfadeRef.current.detach();
      // Keep gapless prebuffer when resolving the next queue track — prefetch may have
      // already warmed the upcoming URL; attachEnvelope promotes it via tryPromotePrebuffer.
      if (prebufferRef.current && !resolveNativeExoTransitionPrefs().gapless) {
        prebufferRef.current.pause();
        prebufferRef.current.removeAttribute('src');
        prebufferRef.current.load();
      }
    }
  }, [resetForNewTrack]);

  const loadEnvelope = useCallback(
    async (next: MediaEnvelope, options?: EnvelopeLoadOptions): Promise<boolean> => {
      if (isStalePlayLoad(next, options)) return false;
      if (options?.seamless !== true) {
        setState('Resolving');
      }
      try {
        await attachEnvelope(next, options);
      } catch (err) {
        console.warn('[useAudioFSM] loadEnvelope failed:', err);
        setState('Failed');
        return false;
      }
      if (options?.playToken != null) {
        return isPlayIntentCurrent(
          options.playToken,
          options.playEnvelopeId ?? next.envelopeId,
        );
      }
      return true;
    },
    [attachEnvelope],
  );

  const loadFromCandidates = useCallback(
    async (
      candidates: CandidateSource[],
      envelopeId?: string,
      options?: Pick<EnvelopeLoadOptions, 'playToken' | 'playEnvelopeId'>,
    ) => {
      setState('Resolving');
      try {
        const resolved = resolveMediaEnvelope(candidates, envelopeId);
        await attachEnvelope(resolved, {
          playToken: options?.playToken ?? currentPlayGeneration(),
          playEnvelopeId: options?.playEnvelopeId ?? resolved.envelopeId,
        });
      } catch (err) {
        console.warn('[useAudioFSM] resolve failed:', err);
        setState('Failed');
      }
    },
    [attachEnvelope],
  );

  const failResolve = useCallback(() => {
    pendingAutoPlayRef.current = false;
    setState('Failed');
  }, []);

  const stop = useCallback(() => {
    pendingAutoPlayRef.current = false;
    exoPlaybackAnchorRef.current = null;
    userPauseHoldPosRef.current = 0;
    latestDisplayPosRef.current = 0;
    if (nativeAudiophileRef.current) {
      void nativeStop();
      revokeObjectUrl();
      envelopeRef.current = null;
      setEnvelope(null);
      setCurrentTimeSeconds(0);
      setDurationSeconds(0);
      setBufferedEndSeconds(0);
      setState('Idle');
      return;
    }

    if (nativeExoRef.current) {
      resetNativeExoEnqueueChain();
      void nativeExoStop();
      nativeExoLastPosRef.current = 0;
      lastRenderedExoPosRef.current = 0;
      setNativeExoEffectivePlaying(false);
      revokeObjectUrl();
      envelopeRef.current = null;
      setEnvelope(null);
      setCurrentTimeSeconds(0);
      setDurationSeconds(0);
      setBufferedEndSeconds(0);
      setState('Idle');
      return;
    }

    const audio = audioRef.current;
    pendingAutoPlayRef.current = false;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    revokeObjectUrl();
    envelopeRef.current = null;
    setEnvelope(null);
    setCurrentTimeSeconds(0);
    setDurationSeconds(0);
    setBufferedEndSeconds(0);
    setState('Idle');
  }, [revokeObjectUrl]);

  /** Poll native player position / state when audiophile path is active. */
  useEffect(() => {
    if (!nativeAudiophileActive) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const status = await nativePlaybackStatus();
        if (cancelled) return;

        if (!userScrubbingRef.current) {
          setCurrentTimeSeconds(status.positionSecs);
        }
        if (status.durationSecs > 0) {
          setDurationSeconds(status.durationSecs);
        }
        const fsm = mapNativeStateToFsm(status.state);
        setState((prev) => (prev === 'Failed' && fsm !== 'Failed' ? prev : fsm));

        if (
          status.state === 'stopped' &&
          status.durationSecs > 0 &&
          status.positionSecs >= status.durationSecs - 0.5 &&
          !nativeEndedRef.current
        ) {
          nativeEndedRef.current = true;
          endedListenersRef.current.forEach((fn) => fn());
        }
      } catch {
        /* native commands unavailable */
      }
    };

    const id = window.setInterval(() => void tick(), 500);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [nativeAudiophileActive]);

  /** Shared ExoPlayer status subscriber (single 400ms bridge poll app-wide). */
  useEffect(() => {
    if (!nativeExoActive) return;

    let cancelled = false;
    const tick = (status: Awaited<ReturnType<typeof nativeExoPlaybackStatus>>) => {
      try {
        if (cancelled || !status.state) return;

        const expectedEnvelopeId = envelopeRef.current?.envelopeId;
        const prevPos = nativeExoLastPosRef.current;
        const polledPos = status.positionSecs ?? 0;

        const awaitingEnvelopeId = exoAwaitingEnvelopeIdRef.current;
        if (awaitingEnvelopeId) {
          const nativeId = status.envelopeId?.trim();
          if (nativeId === awaitingEnvelopeId) {
            exoAwaitingEnvelopeIdRef.current = null;
          } else if (status.state === 'error' || status.error) {
            exoAwaitingEnvelopeIdRef.current = null;
          } else {
            if (!userScrubbingRef.current) {
              commitPlaybackPosition(0);
            }
            return;
          }
        }

        const envelopeMatch = nativeStatusMatchesEnvelope(status, expectedEnvelopeId);
        if (!envelopeMatch && !isNativeExoAudible(status, prevPos)) {
          return;
        }
        if (
          !envelopeMatch &&
          isNativeExoAudible(status, prevPos) &&
          status.envelopeId?.trim() &&
          status.envelopeId.trim() !== expectedEnvelopeId?.trim()
        ) {
          return;
        }

        if (userPausedRef.current) {
          const staleUserPause =
            !systemPauseRef.current &&
            Date.now() >= pauseCooldownUntilRef.current &&
            (status.state === 'playing' ||
              isNativeExoAudible(status, prevPos) ||
              effectiveNativeExoState(status, prevPos, { userPaused: false }) ===
                'playing');
          if (staleUserPause) {
            userPausedRef.current = false;
            userPauseHoldPosRef.current = 0;
            pauseCooldownUntilRef.current = 0;
          } else {
            setNativeExoEffectivePlaying(false);
            const reportedDur = status.durationSecs ?? 0;
            const catalogDur = envelopeRef.current?.durationSeconds ?? 0;
            const displayDur = preferEnvelopeDuration(reportedDur);
            if (!userScrubbingRef.current) {
              const hold = resolvePauseHoldPos(displayDur, null, {
                lastRendered: lastRenderedExoPosRef.current,
                latestDisplay: latestDisplayPosRef.current,
                currentTime: userPauseHoldPosRef.current,
                nativePolled: polledPos,
              });
              userPauseHoldPosRef.current = hold;
              commitPlaybackPosition(hold);
            }
            if (reportedDur > 0) setStreamDurationSeconds(reportedDur);
            if (reportedDur > 0 || catalogDur > 0) {
              setDurationSeconds(displayDur);
            }
            setState((prev) => {
              if (prev === 'Failed') return prev;
              return prev === 'Playing' || prev === 'Connecting' ? 'Ready' : prev;
            });
            return;
          }
        }

        const reportedDur = status.durationSecs ?? 0;
        const catalogDur = envelopeRef.current?.durationSeconds ?? 0;
        const displayDur = preferEnvelopeDuration(reportedDur);
        const canAutoResumeNative =
          !userPausedRef.current && Date.now() >= pauseCooldownUntilRef.current;

        let effectiveState = effectiveNativeExoState(status, prevPos, {
          userPaused: userPausedRef.current,
        });
        const durSecs = status.durationSecs ?? 0;

        const synth = synthesizeNativeExoPosition(
          polledPos,
          effectiveState,
          exoPlaybackAnchorRef.current,
          lastRenderedExoPosRef.current,
          durSecs,
        );
        exoPlaybackAnchorRef.current = synth.anchor;
        const pos = synth.pos;
        nativeExoLastPosRef.current = polledPos;

        if (isNativeExoAudible(status, prevPos)) {
          nativeExoRef.current = true;
          setNativeExoActive(true);
          const restored = reconcileEnvelopeFromNativeStatus(status, envelopeRef.current);
          if (restored) {
            envelopeRef.current = restored;
            setEnvelope(restored);
            if (import.meta.env.DEV) {
              console.log(
                `[useAudioFSM] restored envelope from native ${JSON.stringify({
                  title: restored.title,
                  state: status.state,
                })}`,
              );
            }
          }
        }

        setNativeExoEffectivePlaying(
          nativeExoUiIsPlaying(status, effectiveState, prevPos, pos),
        );
        const uiPlaying = nativeExoUiIsPlaying(status, effectiveState, prevPos, pos);
        if (uiPlaying) {
          lastNativePlayingAtRef.current = Date.now();
        }
        if (
          canAutoResumeNative &&
          !userPausedRef.current &&
          !systemPauseRef.current &&
          !userScrubbingRef.current &&
          pendingAutoPlayRef.current &&
          (effectiveState === 'paused' || effectiveState === 'loading') &&
          durSecs > 0 &&
          Date.now() - nativeExoStuckResumeAtRef.current > 2000
        ) {
          nativeExoStuckResumeAtRef.current = Date.now();
          void nativeExoResume();
        }
        if (
          canAutoResumeNative &&
          !userPausedRef.current &&
          !systemPauseRef.current &&
          !userScrubbingRef.current &&
          lastNativePlayingAtRef.current > 0 &&
          Date.now() - lastNativePlayingAtRef.current < 60_000 &&
          (effectiveState === 'paused' || (effectiveState === 'idle' && pos > 0.5)) &&
          durSecs > 0 &&
          pos > 0.5 &&
          pos < durSecs - 2 &&
          Date.now() - nativeExoStuckResumeAtRef.current > 2500
        ) {
          nativeExoStuckResumeAtRef.current = Date.now();
          void nativeExoResume();
        }
        const allowRegression = Date.now() - userSeekedAtRef.current < 2000;
        if (!userScrubbingRef.current) {
          const renderedPos = reconcileNativeExoPosition(
            pos,
            effectiveState,
            lastRenderedExoPosRef.current ?? 0,
            allowRegression,
            prevPos,
          );
          const displayPos = catalogPlaybackDisplayPosition(
            renderedPos,
            reportedDur,
            catalogDur,
            displayDur,
          );
          lastRenderedExoPosRef.current = renderedPos;
          latestDisplayPosRef.current = displayPos;
          scheduleDisplayPosition(displayPos);
          maybeFireCatalogTrackEnd(renderedPos, reportedDur);
        }
        if (reportedDur > 0) setStreamDurationSeconds(reportedDur);
        if (reportedDur > 0 || catalogDur > 0) {
          setDurationSeconds(displayDur);
        }
        const fsm = mapNativeExoStateToFsm(effectiveState);
        setState((prev) => {
          if (prev === 'Failed' && fsm !== 'Failed') return prev;
          if (effectiveState === 'error') {
            if (prev === 'Resolving' || prev === 'Connecting') {
              pendingAutoPlayRef.current = false;
              return 'Failed';
            }
            if (
              canAutoResumeNative &&
              !userPausedRef.current &&
              pos > 0.5 &&
              (prev === 'Playing' || prev === 'Ready' || prev === 'Connecting') &&
              Date.now() - nativeExoStuckResumeAtRef.current > 2500
            ) {
              nativeExoStuckResumeAtRef.current = Date.now();
              void nativeExoResume();
              return prev;
            }
            pendingAutoPlayRef.current = false;
            return 'Failed';
          }
          if (
            (prev === 'Resolving' || prev === 'Connecting') &&
            fsm === 'Idle' &&
            pendingAutoPlayRef.current
          ) {
            return prev;
          }
          if (uiPlaying && fsm !== 'Failed' && fsm !== 'Playing') {
            return 'Playing';
          }
          return fsm;
        });

        const dur = reportedDur;
        const queueIdx = status.queueIndex ?? 0;
        const queueLen = status.queueLength ?? 1;
        nativeExoQueueAheadRef.current =
          queueLen > 1 && queueIdx < queueLen - 1;
        const atQueueEnd = queueIdx >= queueLen - 1;
        if (
          effectiveState === 'stopped' &&
          dur > 0 &&
          pos >= dur - 0.5 &&
          atQueueEnd &&
          !nativeExoEndedRef.current
        ) {
          const looksTruncated =
            catalogDur > dur + 20 &&
            pos < catalogDur - 15 &&
            !nativeExoTruncatedHealRef.current;
          if (looksTruncated) {
            nativeExoTruncatedHealRef.current = true;
            if (import.meta.env.DEV) {
              console.warn(
                `[useAudioFSM] truncated stream end pos=${pos.toFixed(1)} exoDur=${dur.toFixed(1)} catalogDur=${catalogDur.toFixed(1)}`,
              );
            }
            window.dispatchEvent(
              new CustomEvent('sandbox-playback-truncated', {
                detail: { positionSecs: pos, streamDurSecs: dur, catalogDurSecs: catalogDur },
              }),
            );
          } else {
            nativeExoEndedRef.current = true;
            endedListenersRef.current.forEach((fn) => fn());
          }
        }
        if (effectiveState === 'playing') {
          nativeExoEndedRef.current = false;
        nativeExoTruncatedHealRef.current = false;
        }
      } catch {
        /* ExoPlayer commands unavailable */
      }
    };

    const unsub = subscribeNativeExoStatus((status) => tick(status));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [nativeExoActive]);

  /** Boot reconcile — native Exo may survive WebView reload while JS state is fresh/Idle. */
  const reconcileFromNativeExo = useCallback(async (): Promise<boolean> => {
    if (!isAndroidNativePlaybackLikely()) return false;
    try {
      const status = await nativeExoPlaybackStatus();
      if (!isNativeExoAudible(status)) return false;
      nativeExoRef.current = true;
      setNativeExoActive(true);
      const restored = reconcileEnvelopeFromNativeStatus(status, envelopeRef.current);
      if (restored) {
        envelopeRef.current = restored;
        setEnvelope(restored);
      }
      const effectiveState = effectiveNativeExoState(status);
      setState(mapNativeExoStateToFsm(effectiveState));
      const awaiting = exoAwaitingEnvelopeIdRef.current;
      if (awaiting) {
        setCurrentTimeSeconds(0);
      } else if ((status.positionSecs ?? 0) > 0) {
        const nativeId = status.envelopeId?.trim();
        const currentId = envelopeRef.current?.envelopeId?.trim();
        if (!nativeId || !currentId || nativeId === currentId) {
          setCurrentTimeSeconds(status.positionSecs ?? 0);
        }
      }
      if ((status.durationSecs ?? 0) > 0) {
        setDurationSeconds(preferEnvelopeDuration(status.durationSecs ?? 0));
      }
      setNativeExoEffectivePlaying(
        nativeExoUiIsPlaying(
          status,
          effectiveState,
          status.positionSecs ?? 0,
          status.positionSecs ?? 0,
        ),
      );
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    void reconcileFromNativeExo();
  }, [reconcileFromNativeExo]);

  useEffect(() => {
    if (!nativeExoActive) return;
    void syncNativeExoPlaybackPrefs(resolveNativeExoTransitionPrefs());
    void initNativeExoPlaybackEvents((evt) => {
      if (evt.event === 'queueEnded') {
        if (!nativeExoEndedRef.current) {
          nativeExoEndedRef.current = true;
          endedListenersRef.current.forEach((fn) => fn());
        }
        return;
      }
      if (evt.event !== 'mediaItemTransition') return;
      nativeExoEndedRef.current = false;
      window.dispatchEvent(
        new CustomEvent('sandbox-exo-media-transition', { detail: evt }),
      );
    });
    return () => {
      void teardownNativeExoPlaybackEvents();
    };
  }, [nativeExoActive]);

  useEffect(() => {
    const savedVolume = loadPlaybackVolume();
    preMuteVolumeRef.current = savedVolume > 0 ? savedVolume : 1.0;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = savedVolume;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('webkit-playsinline', '');
    audio.muted = false;
    audioRef.current = audio;
    bindAudioElement(audio);

    return () => {
      pendingAutoPlayRef.current = false;
      audio.pause();
      audio.removeAttribute('src');
      unbindAudioRef.current?.();
      unbindAudioRef.current = null;
      audioRef.current = null;
      revokeObjectUrl();
      crossfadeRef.current.detach();
      if (prebufferRef.current) {
        prebufferRef.current.pause();
        prebufferRef.current.removeAttribute('src');
        prebufferRef.current = null;
      }
    };
  }, [revokeObjectUrl, bindAudioElement]);

  useEffect(() => {
    applyEffectiveVolume(volume, isMuted);
  }, [volume, isMuted, applyEffectiveVolume]);

  /** Auto-play immediately when Ready follows a load (not after manual pause). */
  useEffect(() => {
    if (state !== 'Ready' || !pendingAutoPlayRef.current || userPausedRef.current) return;
    pendingAutoPlayRef.current = false;
    void play();
  }, [state, play]);

  const title = envelope?.title ?? '';
  const artist = envelope?.artist ?? '';
  const url = envelope?.url ?? '';
  const provider = envelope?.provider ?? 'unknown';
  const transport = envelope?.transport ?? 'element-src';

  return useMemo(
    () => ({
      state,
      title,
      artist,
      url,
      currentTimeSeconds,
      durationSeconds,
      bufferedEndSeconds,
      provider,
      transport,
      envelope,
      play,
      pause,
      seek,
      beginScrub,
      endScrub,
      volume,
      isMuted,
      setVolume,
      toggleMute,
      beginResolve,
      loadEnvelope,
      loadFromCandidates,
      stop,
      failResolve,
      subscribeEnded,
      prebufferUrl,
      flushNativeExoEnqueueChain,
      primePlaybackGesture,
      nativeExoActive,
      nativeExoEffectivePlaying,
      streamDurationSeconds,
      adoptQueueTrack,
      reconcileFromNativeExo,
      playbackRate,
      setPlaybackRate,
      getPlaybackLevelAnalyser,
      applyPodcastEpisodeVolumeBoostDb,
      refreshPodcastPlaybackChain,
    }),
    [
      state,
      title,
      artist,
      url,
      currentTimeSeconds,
      durationSeconds,
      bufferedEndSeconds,
      provider,
      transport,
      envelope,
      play,
      pause,
      seek,
      beginScrub,
      endScrub,
      volume,
      isMuted,
      setVolume,
      toggleMute,
      beginResolve,
      loadEnvelope,
      loadFromCandidates,
      stop,
      failResolve,
      subscribeEnded,
      prebufferUrl,
      flushNativeExoEnqueueChain,
      primePlaybackGesture,
      nativeExoActive,
      nativeExoEffectivePlaying,
      streamDurationSeconds,
      adoptQueueTrack,
      reconcileFromNativeExo,
      playbackRate,
      setPlaybackRate,
      getPlaybackLevelAnalyser,
      applyPodcastEpisodeVolumeBoostDb,
      refreshPodcastPlaybackChain,
    ],
  );
}
