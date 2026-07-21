const fs = require('fs');
const path = require('path');
const root = 'C:/Users/RH/Downloads/sovereign-music-console';

function patch(file, replacements) {
  let text = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) throw new Error(`Missing patch anchor in ${file}: ${from.slice(0, 80)}`);
    text = text.replace(from, to);
  }
  fs.writeFileSync(path.join(root, file), text, 'utf8');
}

// Cap podcast library episodes per feed
patch('src/podcastStorage.ts', [
  [`const PLAYBACK_STATE_KEY = 'sandbox_podcast_playback_state_v1';`, `const PLAYBACK_STATE_KEY = 'sandbox_podcast_playback_state_v1';\n/** Avoid localStorage quota blow-ups on huge feeds (e.g. JRE). */\nexport const MAX_EPISODES_PERSISTED_PER_FEED = 120;`],
  [`export function saveEpisodesForFeed(feedId: string, episodes: PodcastEpisode[]): void {
  const lib = readLibrary();
  const previous = lib.episodesByFeed[feedId] ?? [];`, `function trimEpisodesForPersistence(episodes: PodcastEpisode[]): PodcastEpisode[] {
  const cap = MAX_EPISODES_PERSISTED_PER_FEED;
  if (episodes.length <= cap) return episodes;
  return [...episodes]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, cap);
}

export function saveEpisodesForFeed(feedId: string, episodes: PodcastEpisode[]): void {
  const lib = readLibrary();
  const previous = lib.episodesByFeed[feedId] ?? [];
  episodes = trimEpisodesForPersistence(episodes);`],
]);

// Catalog helper: play one episode without persisting full feed
patch('src/podcastCatalog.ts', [
  [`/** Subscribe to a catalog show and fetch episodes. */`, `function pickEpisodeByQuery(
  episodes: import('./podcastStorage').PodcastEpisode[],
  episodeQuery: string,
): import('./podcastStorage').PodcastEpisode | undefined {
  const q = episodeQuery.trim();
  if (!q) return episodes[0];
  const epNum = q.match(/#?(\\d{3,5})\\b/)?.[1];
  if (epNum) {
    return (
      episodes.find((e) => e.title.includes(epNum) || e.id.includes(epNum)) ?? episodes[0]
    );
  }
  const tokens = q.toLowerCase().split(/\\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return episodes[0];
  return (
    episodes.find((e) => {
      const blob = e.title.toLowerCase();
      return tokens.every((t) => blob.includes(t));
    }) ?? episodes[0]
  );
}

/** Fetch RSS and pick one episode without writing the full library (online stream E2E). */
export async function resolveOnlineCatalogEpisode(
  feedQuery: string,
  episodeQuery: string,
): Promise<{
  feedTitle: string;
  feedArtworkUrl?: string;
  episode: import('./podcastStorage').PodcastEpisode;
} | null> {
  const shows = await searchPodcastCatalogShows(feedQuery, 8);
  const feedLower = feedQuery.trim().toLowerCase();
  const show =
    shows.find((s) => s.title.toLowerCase().includes(feedLower.split(' ')[0] ?? '')) ??
    shows.find((s) => feedLower.split(/\\s+/).every((t) => t.length > 2 && s.title.toLowerCase().includes(t))) ??
    shows[0];
  if (!show?.feedUrl?.trim()) return null;
  const parsed = await fetchPodcastFeed(show.feedUrl);
  const episode = pickEpisodeByQuery(parsed.episodes, episodeQuery);
  if (!episode?.audioUrl?.trim()) return null;
  return {
    feedTitle: show.title || parsed.subscription.title,
    feedArtworkUrl: show.artworkUrl ?? parsed.subscription.artworkUrl,
    episode,
  };
}

/** Subscribe to a catalog show and fetch episodes. */`],
]);

// e2e handler type + cases
patch('src/e2eDevAction.ts', [
  [`  playPodcastQuery?: (query: string) => Promise<boolean>;`, `  playPodcastQuery?: (query: string) => Promise<boolean>;
  /** Play a specific episode on a feed via HTTPS enclosure (optional online-only). */
  playPodcastEpisode?: (
    feedQuery: string,
    episodeQuery: string,
    options?: { online?: boolean },
  ) => Promise<boolean>;`],
  [`import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';
import { loadSubscriptions } from './podcastStorage';`, `import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';
import { loadSubscriptions, removeSubscription } from './podcastStorage';`],
  [`    case 'clear-playback-caches': {
      clearPlayUrlCache();
      await clearStreamCache();
      logE2e('playback-caches', true, 'cleared play-url + stream caches');
      return true;
    }`, `    case 'clear-playback-caches': {
      clearPlayUrlCache();
      await clearStreamCache();
      if (params.get('podcasts') === '1' || params.get('podcasts') === 'true') {
        for (const sub of [...loadSubscriptions()]) {
          removeSubscription(sub.id);
        }
        logE2e('playback-caches', true, 'cleared play-url + stream caches + podcast library');
      } else {
        logE2e('playback-caches', true, 'cleared play-url + stream caches');
      }
      return true;
    }`],
  [`    case 'podcast-play': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.playPodcastQuery) {
        logE2e('podcast-play', false, 'missing query or playPodcastQuery handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(600);
      const played = await handlers.playPodcastQuery(query);
      if (!played) {
        logE2e('podcast-play', false, \`query=\${query} play=false\`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '180000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 180_000,
      );
      logE2e('podcast-play', ok, \`query=\${query} playing=\${ok}\`);
      return ok;
    }`, `    case 'podcast-play': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.playPodcastQuery) {
        logE2e('podcast-play', false, 'missing query or playPodcastQuery handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(600);
      const played = await handlers.playPodcastQuery(query);
      if (!played) {
        logE2e('podcast-play', false, \`query=\${query} play=false\`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '180000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 180_000,
      );
      logE2e('podcast-play', ok, \`query=\${query} playing=\${ok}\`);
      return ok;
    }
    case 'podcast-play-episode': {
      const feed = params.get('feed')?.trim();
      const episode = params.get('episode')?.trim();
      const online = params.get('online') !== '0';
      if (!feed || !episode || !handlers.playPodcastEpisode) {
        logE2e('podcast-play-episode', false, 'missing feed/episode or playPodcastEpisode handler');
        return false;
      }
      savePodcastsEnabled(true);
      bumpPlayGeneration();
      await nativeExoStop();
      handlers.navigateTab?.('podcasts');
      await sleep(600);
      const played = await handlers.playPodcastEpisode(feed, episode, { online });
      if (!played) {
        logE2e('podcast-play-episode', false, \`feed=\${feed} episode=\${episode} play=false\`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '240000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 240_000,
      );
      const probe = handlers.getPlaybackProbe?.();
      const urlHint = probe?.title ? \` title=\${probe.title}\` : '';
      logE2e(
        'podcast-play-episode',
        ok,
        \`feed=\${feed} episode=\${episode} online=\${online} playing=\${ok}\${urlHint}\`,
      );
      return ok;
    }`],
]);

// sandboxLayer3 handler
let l3 = fs.readFileSync(path.join(root, 'src/sandboxLayer3.tsx'), 'utf8');
if (!l3.includes('resolveOnlineCatalogEpisode')) {
  l3 = l3.replace(
    `import { searchPodcastsUnified, subscribeFromCatalogShow, type PodcastCatalogEpisodeHit } from './podcastCatalog';`,
    `import {
  resolveOnlineCatalogEpisode,
  searchPodcastsUnified,
  subscribeFromCatalogShow,
  type PodcastCatalogEpisodeHit,
} from './podcastCatalog';`,
  );
}
const playPodcastBlock = `      playPodcastQuery: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const q = query.trim();
        const qLower = q.toLowerCase();
        const episodeNum = q.match(/#?(\\d{3,5})\\b/)?.[1];
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
          const tokens = qLower.split(/\\s+/).filter((t) => t.length > 2);
          if (!tokens.length) return catalogHits[0];
          return catalogHits.find((h) => {
            const blob = \`\${h.envelope?.artist ?? ''} \${h.episode?.title ?? h.envelope?.title ?? ''}\`.toLowerCase();
            return tokens.every((t) => blob.includes(t));
          });
        };
        const catalogHit = pickCatalogHit() ?? catalogHits[0];
        const localHit = localHits[0];
        const localTitle = localHit?.envelope?.title ?? '';
        const useLocal =
          Boolean(localHit?.envelope?.url?.trim()) &&
          (!episodeNum || localTitle.includes(episodeNum));
        if (useLocal) {
          return await playEnvelopeRef.current(localHit.envelope, undefined, { autoPlay: true });
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
      },`;

const playPodcastPatched = `      playPodcastQuery: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const q = query.trim();
        const qLower = q.toLowerCase();
        const episodeNum = q.match(/#?(\\d{3,5})\\b/)?.[1];
        const guestTokens = qLower
          .replace(/joe\\s+rogan\\s+experience/g, '')
          .replace(/#?\\d{3,5}/g, '')
          .split(/\\s+/)
          .filter((t) => t.length > 2);
        const episodeTitleQuery = guestTokens.length ? guestTokens.join(' ') : episodeNum ?? '';
        if (episodeTitleQuery) {
          const online = await resolveOnlineCatalogEpisode('Joe Rogan Experience', episodeTitleQuery);
          if (online?.episode?.audioUrl?.trim()) {
            return await playEnvelopeRef.current(
              episodeEnvelope(online.episode, online.feedTitle, online.feedArtworkUrl),
              undefined,
              { autoPlay: true },
            );
          }
        }
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
          const tokens = qLower.split(/\\s+/).filter((t) => t.length > 2);
          if (!tokens.length) return catalogHits[0];
          return catalogHits.find((h) => {
            const blob = \`\${h.envelope?.artist ?? ''} \${h.episode?.title ?? h.envelope?.title ?? ''}\`.toLowerCase();
            return tokens.every((t) => blob.includes(t));
          });
        };
        const catalogHit = pickCatalogHit() ?? catalogHits[0];
        const localHit = localHits[0];
        const localTitle = localHit?.envelope?.title ?? '';
        const useLocal =
          Boolean(localHit?.envelope?.url?.trim()) &&
          (!episodeNum || localTitle.includes(episodeNum)) &&
          !guestTokens.length;
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
      },`;

if (!l3.includes(playPodcastBlock)) throw new Error('playPodcastQuery block not found');
l3 = l3.replace(playPodcastBlock, playPodcastPatched);
fs.writeFileSync(path.join(root, 'src/sandboxLayer3.tsx'), l3, 'utf8');

// Fix adb deep link quoting
let ps1 = fs.readFileSync(path.join(root, 'scripts/_e2e-android-hardening.ps1'), 'utf8');
const oldDl = `    $uri = 'sandboxmusic://e2e/' + $Path
    $activity = Get-E2eMainActivity
    $waitFlag = if ($WaitStart) { '-W ' } else { '' }
    $shellCmd = ('am start {0}-a android.intent.action.VIEW -d ''{1}'' -n {2} -f 0x14000000' -f $waitFlag, $uri, $activity)`;
const newDl = `    $uri = 'sandboxmusic://e2e/' + $Path
    $activity = Get-E2eMainActivity
    $waitFlag = if ($WaitStart) { '-W ' } else { '' }
  # Quote URI for Android shell so query params with & are not split.
    $shellCmd = ('am start {0}-a android.intent.action.VIEW -d "{1}" -n {2} -f 0x14000000' -f $waitFlag, $uri, $activity)`;
if (!ps1.includes(oldDl)) throw new Error('Start-E2eDeepLink block not found');
ps1 = ps1.replace(oldDl, newDl);
fs.writeFileSync(path.join(root, 'scripts/_e2e-android-hardening.ps1'), ps1, 'utf8');

console.log('Patches applied OK');
