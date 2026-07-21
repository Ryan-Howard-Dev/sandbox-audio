const fs = require("fs");
const p = "C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx";
let l = fs.readFileSync(p, "utf8");
l = l.replace(
  "import {\n  cacheEnvelopeForOffline,\n  warmStreamCacheIndex,\n} from './streamCache';",
  "import {\n  cacheEnvelopeForOffline,\n  getStreamCacheEnvelope,\n  warmStreamCacheIndex,\n} from './streamCache';",
);
l = l.replace("import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';\n", "");
l = l.replace("import { resolvePodcastEnvelopeForPlayback } from './podcastPlayback';\n", "");
l = l.replace("import { cacheEnvelopeForOffline, getStreamCacheEnvelope } from './streamCache';\n", "");
if (!l.includes("loadOfflinePodcastEpisodes")) {
  l = l.replace(
    "import { episodeEnvelope } from './podcastSearch';",
    "import { episodeEnvelope } from './podcastSearch';\nimport { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';",
  );
}
const badCache = `      cachePodcastQueryOffline: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        const started = await handlers.playPodcastQuery?.(query);
        if (!started) return false;
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          const probe = handlers.getPlaybackProbe?.();
          if (probe?.title?.trim() && (probe.state === 'Playing' || probe.state === 'Ready')) {
            break;
          }
          await new Promise((r) => window.setTimeout(r, 300));
        }
        const probe = handlers.getPlaybackProbe?.();
        if (!probe?.title?.trim()) return false;
        const env = {
          envelopeId: probe.envelopeId ?? \`podcast-e2e-\${probe.title}\`,
          title: probe.title,
          artist: probe.artist,
          album: probe.album ?? probe.artist,
          url: audioEnvelopeRef.current?.url ?? '',
          durationSeconds: probe.durationSecs ?? 0,
          provider: 'https' as const,
          transport: 'element-src' as const,
          sourceId: probe.envelopeId ?? probe.title,
        };
        if (!env.url?.trim()) return false;
        await cacheEnvelopeForOffline(env);
        return Boolean(await getStreamCacheEnvelope(env));
      },
      playPodcastQuery: async (query) => {`;
const goodCache = `      playPodcastQuery: async (query) => {`;
if (l.includes("handlers.playPodcastQuery")) {
  l = l.replace(badCache, goodCache);
}
const playPodcastEnd = `        return true;
      },
    });
  }, [runSearch, handleMobileTabNavigate, station]);`;
const cacheHandler = `        return true;
      },
      cachePodcastQueryOffline: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(query, {
          catalogLimit: 8,
        });
        const localHit = localHits[0];
        let envelope = localHit?.envelope;
        if (!envelope?.url?.trim()) {
          const catalogHit = catalogHits[0];
          envelope = catalogHit?.envelope;
        }
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
          if (state === 'Playing' || (state === 'Ready' && Boolean(audioEnvelopeRef.current?.url?.trim()))) {
            break;
          }
          if (state === 'Failed') return false;
          await new Promise((r) => window.setTimeout(r, 300));
        }
        const playingEnv = audioEnvelopeRef.current;
        if (!playingEnv?.url?.trim()) return false;
        await cacheEnvelopeForOffline(playingEnv);
        return Boolean(await getStreamCacheEnvelope(playingEnv));
      },
    });
  }, [runSearch, handleMobileTabNavigate, station]);`;
if (!l.includes("cachePodcastQueryOffline:")) {
  throw new Error("cache handler missing after first fix");
}
// only replace end block once - find playPodcastQuery closing before register end
const marker = "      playPodcastQuery: async (query) => {";
const idx = l.indexOf(marker);
if (idx < 0) throw new Error("playPodcastQuery not found");
const tail = l.slice(idx);
const endIdx = tail.indexOf(playPodcastEnd);
if (endIdx < 0) {
  // try alternate - maybe already fixed
  console.log("end block not found, checking...");
} else {
  l = l.slice(0, idx) + tail.replace(playPodcastEnd, cacheHandler);
}
fs.writeFileSync(p, l);
console.log("fixed sandboxLayer3 imports and cache handler");
