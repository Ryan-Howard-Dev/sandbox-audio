const fs = require("fs");
const p = "C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx";
let l = fs.readFileSync(p, "utf8");
l = l.replace(
  "import {\n  cacheEnvelopeForOffline,\n  warmStreamCacheIndex,\n} from './streamCache';",
  "import {\n  cacheEnvelopeForOffline,\n  getStreamCacheEnvelope,\n  warmStreamCacheIndex,\n} from './streamCache';",
);
l = l.replace(
  "import { resolvePodcastEnvelopeForPlayback } from './podcastPlayback';\nimport { cacheEnvelopeForOffline, getStreamCacheEnvelope } from './streamCache';\n",
  "",
);
const re =
  /      cachePodcastQueryOffline: async \(query\) => \{[\s\S]*?      playPodcastQuery: async \(query\) => \{/;
const rep = `      cachePodcastQueryOffline: async (query) => {
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
      playPodcastQuery: async (query) => {`;
if (!re.test(l)) throw new Error("cache block pattern not found");
l = l.replace(re, rep);
fs.writeFileSync(p, l);
console.log("fixed");
