/**
 * Pure builder for the search/podcast subset of E2E handlers that sandboxLayer3 registers via
 * registerE2eHandlers (a separate registration from the playback-verb set installE2eLiveHandlers
 * covers). Moved out for the same reason as shellE2eLiveHandlers: the object literal is closures
 * over refs/setters the shell already owns, with no JSX and no hook calls of its own.
 *
 * Call buildE2eSearchHandlers(deps) from inside the *same* useEffect that used to contain this
 * object literal, at its original position in sandboxLayer3 (right after useShellSearchRunner).
 * Registration — registerE2eHandlers and the effect's dependency array — stays in the shell.
 *
 * playEnvelopeRef, audioEnvelopeRef, audioCurrentTimeRef, audioDurationRef, and audioStateRef are
 * declared later in sandboxLayer3 than this effect's original position. That was already true
 * before this extraction: the effect callback only runs post-commit, by which point every const in
 * the component body has been assigned for that render, so closing over them here is exactly as
 * safe as it was inline.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AudioFsmState, CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { E2eHandlers, E2eNavTab } from '../e2eDevAction';
import type { CatalogTrack } from '../searchCatalog';
import type { MobileTabId, StationId } from './shellNav';
import type { UnifiedSearchResult } from '../unifiedSearch';

import { waitForPlaybackStarted } from '../e2ePlaybackWait';
import { isAndroid } from '../platformEnv';
import { hasActiveMobileResolvers, ensureYtDlpMobileReady } from '../mobileResolverRegistry';
import { waitForYtDlpInit } from '../ytDlpMobile';
import { isEnvelopeStreamCached, cacheEnvelopeForOffline, getStreamCacheEnvelope } from '../streamCache';
import { savePodcastsEnabled } from '../podcastSettings';
import { resolveOnlineCatalogEpisode, searchPodcastsUnified, subscribeFromCatalogShow } from '../podcastCatalog';
import { episodeEnvelope } from '../podcastSearch';
import { loadOfflinePodcastEpisodes } from '../podcastOfflineEpisodes';

export type E2eSearchHandlersDeps = {
  runSearch: (query: string) => Promise<number | void>;
  handleMobileTabNavigate: (id: MobileTabId) => void;
  transitionToSearchStation: () => void;
  setNavOpen: Dispatch<SetStateAction<boolean>>;
  setOnboardingComplete: Dispatch<SetStateAction<boolean>>;
  searchHitsRef: MutableRefObject<ResolvedSearchHit[]>;
  unifiedSearchResultRef: MutableRefObject<UnifiedSearchResult>;
  webSupplementTracksRef: MutableRefObject<CatalogTrack[]>;
  station: StationId;
  setStation: Dispatch<SetStateAction<StationId>>;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
  audio: UseAudioFSMResult;
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
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioCurrentTimeRef: MutableRefObject<number>;
  audioDurationRef: MutableRefObject<number>;
  audioStateRef: MutableRefObject<AudioFsmState>;
  searchReturnStationRef: MutableRefObject<StationId>;
  searchLoadingRef: MutableRefObject<boolean>;
  unifiedSearchLoadingRef: MutableRefObject<boolean>;
  setPodcastsEnabled: Dispatch<SetStateAction<boolean>>;
};

export function buildE2eSearchHandlers({
  runSearch,
  handleMobileTabNavigate,
  transitionToSearchStation,
  setNavOpen,
  setOnboardingComplete,
  searchHitsRef,
  unifiedSearchResultRef,
  webSupplementTracksRef,
  station,
  setStation,
  setHomeAwaitingUserResume,
  audio,
  playEnvelopeRef,
  audioEnvelopeRef,
  audioCurrentTimeRef,
  audioDurationRef,
  audioStateRef,
  searchReturnStationRef,
  searchLoadingRef,
  unifiedSearchLoadingRef,
  setPodcastsEnabled,
}: E2eSearchHandlersDeps): E2eHandlers {
  return {
    runSearch: (q) => runSearch(q),
    navigateTab: (tab: E2eNavTab) => {
      void import('../stations/SearchResultsView');
      if (tab === 'search') {
        transitionToSearchStation();
        setNavOpen(false);
        return;
      }
      handleMobileTabNavigate(tab as MobileTabId);
    },
    completeOnboarding: () => setOnboardingComplete(true),
    getSearchHitCount: () => {
      const hits = searchHitsRef.current.length;
      const unifiedTracks = unifiedSearchResultRef.current.tracks?.length ?? 0;
      const webBuffered = webSupplementTracksRef.current.length;
      return Math.max(hits, unifiedTracks, webBuffered);
    },
    getSearchHitSummary: (limit = 5) => {
      // Reads searchHits first because that is the list playSearchQuery indexes into — reporting
      // the unified list instead would describe an order nothing plays from.
      const hits = searchHitsRef.current.slice(0, limit).map((h) => {
        const env = h.primaryEnvelope;
        return `${env?.artist ?? '?'} — ${env?.title ?? '?'}`;
      });
      if (hits.length > 0) return hits;
      return unifiedSearchResultRef.current.tracks
        .slice(0, limit)
        .map((t) => `${t.artist} — ${t.title}`);
    },
    playMobileQuery: async (query) => {
      const env: MediaEnvelope = {
        envelopeId: `e2e-mobile-${Date.now()}`,
        title: query,
        artist: '',
        url: '',
        durationSeconds: 0,
        provider: 'https',
        transport: 'element-src',
        sourceId: `e2e-mobile-${Date.now()}`,
      };
      setStation('home');
      setHomeAwaitingUserResume(false);
      if (isAndroid() && hasActiveMobileResolvers()) {
        ensureYtDlpMobileReady();
        await waitForYtDlpInit();
      }
      await playEnvelopeRef.current(env, undefined, { autoPlay: true });
      const nudgePlayback = async () => {
        audio.primePlaybackGesture();
        await audio.play();
      };
      return waitForPlaybackStarted({
        expectedTitle: query,
        getProbeTitle: () => audioEnvelopeRef.current?.title,
        getProbePosition: () => audioCurrentTimeRef.current,
        getProbeDuration: () => audioDurationRef.current,
        getProbeState: () => audioStateRef.current,
        timeoutMs: 300_000,
        onStuck: nudgePlayback,
      });
    },
    playSearchQuery: async (query, hitIndex = 0) => {
      setHomeAwaitingUserResume(false);
      if (station !== 'search') {
        searchReturnStationRef.current = station;
      }
      setStation('search');
      setNavOpen(false);
      await runSearch(query);
      const searchDeadline = Date.now() + 90_000;
      while (Date.now() < searchDeadline) {
        const loading = searchLoadingRef.current || unifiedSearchLoadingRef.current;
        if (!loading) {
          const hit = searchHitsRef.current[hitIndex];
          const catalogTrack = unifiedSearchResultRef.current.tracks[hitIndex];
          if (hit?.primaryEnvelope || catalogTrack?.envelope) break;
        }
        await new Promise((r) => window.setTimeout(r, 250));
      }
      const hit = searchHitsRef.current[hitIndex];
      const catalogTrack = unifiedSearchResultRef.current.tracks[hitIndex];
      const envelope = hit?.primaryEnvelope ?? catalogTrack?.envelope;
      const candidates = hit?.sources;
      if (!envelope) {
        /*
         * One line, interpolated. This used to pass an object, which the Android bridge prints
         * as "[object Object]" — so the one diagnostic covering a failed search told you only
         * that it had failed, which is what you already knew from the FAIL line.
         */
        console.warn(
          `[playSearchQuery] no envelope query="${query}" hitIndex=${hitIndex} ` +
            `hits=${searchHitsRef.current.length} ` +
            `catalogTracks=${unifiedSearchResultRef.current.tracks.length} ` +
            `stillLoading=${searchLoadingRef.current || unifiedSearchLoadingRef.current}`,
        );
        return false;
      }
      if (isAndroid() && hasActiveMobileResolvers()) {
        ensureYtDlpMobileReady();
        await waitForYtDlpInit();
      }
      /*
       * What was chosen, and out of what. A search can rank correctly and still play the wrong
       * recording — the list and the pick are separate steps, and without this the only visible
       * evidence is the track that came out of the speaker.
       */
      console.warn(
        `[playSearchQuery] picked "${envelope.artist} — ${envelope.title}" ` +
          `id=${envelope.envelopeId} provider=${envelope.provider} ` +
          `sources=${candidates?.length ?? 0} ` +
          `hit0="${searchHitsRef.current[0]?.primaryEnvelope?.artist} — ` +
          `${searchHitsRef.current[0]?.primaryEnvelope?.title}" ` +
          `hits=${searchHitsRef.current.length}`,
      );
      await playEnvelopeRef.current(envelope, candidates, {
        autoPlay: true,
        seedSearchQueue: true,
      });
      const nudgePlayback = async () => {
        audio.primePlaybackGesture();
        await audio.play();
      };
      return waitForPlaybackStarted({
        expectedTitle: envelope.title,
        getProbeTitle: () => audioEnvelopeRef.current?.title,
        getProbePosition: () => audioCurrentTimeRef.current,
        getProbeDuration: () => audioDurationRef.current,
        getProbeState: () => audioStateRef.current,
        timeoutMs: 300_000,
        onStuck: nudgePlayback,
      });
    },
    playOfflinePodcast: async (index = 0, titleQuery) => {
      setPodcastsEnabled(true);
      savePodcastsEnabled(true);
      setStation('podcasts');
      setNavOpen(false);
      const rows = loadOfflinePodcastEpisodes();
      if (!rows.length) return false;
      let row = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (titleQuery?.trim()) {
        const q = titleQuery.trim().toLowerCase();
        row =
          rows.find(
            (r) =>
              r.episode.title.toLowerCase().includes(q) ||
              r.feedTitle.toLowerCase().includes(q),
          ) ?? row;
      }
      const base = episodeEnvelope(row.episode, row.feedTitle, row.feedArtworkUrl);
      if (!isEnvelopeStreamCached(base)) return false;
      await playEnvelopeRef.current(base, undefined, { autoPlay: true });
      return true;
    },
    cachePodcastQueryOffline: async (query) => {
      setPodcastsEnabled(true);
      savePodcastsEnabled(true);
      setStation('podcasts');
      setNavOpen(false);
      const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(query, {
        catalogLimit: 8,
      });
      let envelope = localHits[0]?.envelope ?? catalogHits[0]?.envelope;
      if (!envelope?.url?.trim()) {
        const show = catalogShows.find((s) =>
          s.title.toLowerCase().includes(query.toLowerCase().split(' ')[0] ?? ''),
        ) ?? catalogShows[0];
        if (!show) return false;
        const { subscription, episodes } = await subscribeFromCatalogShow(show);
        const ep = episodes[0];
        if (!ep?.audioUrl?.trim()) return false;
        envelope = episodeEnvelope(ep, subscription.title, subscription.artworkUrl);
      }
      await playEnvelopeRef.current(envelope, undefined, { autoPlay: true });
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        const state = audioStateRef.current;
        if (state === 'Playing' || (state === 'Ready' && Boolean(audioEnvelopeRef.current?.url?.trim()))) break;
        if (state === 'Failed') return false;
        await new Promise((r) => window.setTimeout(r, 300));
      }
      const playingEnv = audioEnvelopeRef.current;
      if (!playingEnv?.url?.trim()) return false;
      await cacheEnvelopeForOffline(playingEnv);
      return Boolean(await getStreamCacheEnvelope(playingEnv));
    },
    playPodcastQuery: async (query) => {
      setPodcastsEnabled(true);
      savePodcastsEnabled(true);
      setStation('podcasts');
      setNavOpen(false);
      const q = query.trim();
      const qLower = q.toLowerCase();
      const episodeNum = q.match(/#?(\d{3,5})\b/)?.[1];
      const guestTokens = qLower
        .split(/\s+/)
        .filter((t) => t.length > 2 && !/^\d{3,5}$/.test(t));
      const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(q, {
        catalogLimit: 12,
      });
      const pickCatalogHit = () => {
        if (!catalogHits.length) return undefined;
        if (episodeNum) {
          return (
            catalogHits.find((h) => (h.episode?.title ?? h.envelope?.title ?? '').includes(episodeNum)) ??
            catalogHits.find((h) => (h.envelope?.artist ?? '').includes(episodeNum))
          );
        }
        const tokens = qLower.split(/\s+/).filter((t) => t.length > 2);
        if (!tokens.length) return catalogHits[0];
        return catalogHits.find((h) => {
          const blob = `${h.envelope?.artist ?? ''} ${h.episode?.title ?? h.envelope?.title ?? ''}`.toLowerCase();
          return tokens.every((t) => blob.includes(t));
        });
      };
      const catalogHit = pickCatalogHit() ?? catalogHits[0];
      const localHit = localHits[0];
      const localTitle = localHit?.envelope?.title ?? '';
      const useLocal =
        Boolean(localHit?.envelope?.url?.trim()) &&
        (!episodeNum || localTitle.includes(episodeNum)) &&
        guestTokens.length < 2;
      if (useLocal) {
        return await playEnvelopeRef.current(localHit!.envelope, undefined, { autoPlay: true });
      }
      if (catalogHit?.envelope?.url?.trim()) {
        return await playEnvelopeRef.current(catalogHit.envelope, undefined, { autoPlay: true });
      }
      const show = catalogShows.find((s) =>
        s.title.toLowerCase().includes(qLower.split(' ')[0] ?? ''),
      ) ?? catalogShows[0];
      if (!show) return false;
      const { subscription, episodes } = await subscribeFromCatalogShow(show);
      const ep = episodeNum
        ? episodes.find((e) => e.title.includes(episodeNum)) ?? episodes[0]
        : episodes[0];
      if (!ep?.audioUrl?.trim()) return false;
      return await playEnvelopeRef.current(
        episodeEnvelope(ep, subscription.title, subscription.artworkUrl),
        undefined,
        { autoPlay: true },
      );
    },
    playPodcastEpisode: async (feedQuery, episodeQuery, options) => {
      setPodcastsEnabled(true);
      savePodcastsEnabled(true);
      setStation('podcasts');
      setNavOpen(false);
      const onlineOnly = options?.online !== false;
      if (onlineOnly) {
        const resolved = await resolveOnlineCatalogEpisode(feedQuery, episodeQuery);
        if (!resolved?.episode?.audioUrl?.trim()) return false;
        const env = episodeEnvelope(
          resolved.episode,
          resolved.feedTitle,
          resolved.feedArtworkUrl,
        );
        if (env.provider === 'stream-cache') return false;
        return await playEnvelopeRef.current(env, undefined, { autoPlay: true });
      }
      return false;
    },
  };
}
