const fs = require("fs");
const e2ePath = "C:/Users/RH/Downloads/sovereign-music-console/src/e2eDevAction.ts";
const layerPath = "C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx";
let s = fs.readFileSync(e2ePath, "utf8");
if (!s.includes("loadOfflinePodcastEpisodes")) {
  s = s.replace(
    "import { savePodcastsEnabled } from './podcastSettings';",
    "import { savePodcastsEnabled } from './podcastSettings';\nimport { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';",
  );
}
if (!s.includes("playOfflinePodcast?:")) {
  s = s.replace(
    "  playPodcastQuery?: (query: string) => Promise<boolean>;",
    "  playPodcastQuery?: (query: string) => Promise<boolean>;\n  /** Play a downloaded podcast episode (stream cache only). */\n  playOfflinePodcast?: (index?: number, titleQuery?: string) => Promise<boolean>;\n  /** Subscribe/play latest episode online, then save to stream cache for offline. */\n  cachePodcastQueryOffline?: (query: string) => Promise<boolean>;",
  );
}
const insert = `    case 'probe-offline-podcasts': {
      const rows = loadOfflinePodcastEpisodes();
      const pass = rows.length > 0;
      const sample = rows
        .slice(0, 3)
        .map((r) => \`\${r.feedTitle}|\${r.episode.title}\`)
        .join('; ');
      logE2e(
        'probe-offline-podcasts',
        pass,
        pass
          ? \`count=\${rows.length} sample=\${sample}\`
          : 'count=0 no stream-cache podcast episodes',
      );
      return pass;
    }
    case 'play-offline-podcast': {
      const index = Number(params.get('index') ?? '0');
      const query = params.get('query')?.trim() || params.get('title')?.trim();
      if (!handlers.playOfflinePodcast) {
        logE2e('play-offline-podcast', false, 'missing playOfflinePodcast handler');
        return false;
      }
      savePodcastsEnabled(true);
      handlers.navigateTab?.('podcasts');
      await sleep(400);
      const played = await handlers.playOfflinePodcast(
        Number.isFinite(index) ? index : 0,
        query,
      );
      if (!played) {
        logE2e('play-offline-podcast', false, \`index=\${index} query=\${query ?? 'none'} play=false\`);
        return false;
      }
      const playWaitMs = Number(params.get('playTimeoutMs') ?? '180000');
      const ok = await waitForPlayingState(
        Number.isFinite(playWaitMs) && playWaitMs > 0 ? playWaitMs : 180_000,
      );
      const probe = handlers.getPlaybackProbe?.();
      logE2e(
        'play-offline-podcast',
        ok,
        \`index=\${index} query=\${query ?? 'none'} playing=\${ok} title=\${probe?.title ?? 'unknown'}\`,
      );
      return ok;
    }
    case 'cache-podcast-offline': {
      const query = params.get('query')?.trim();
      if (!query || !handlers.cachePodcastQueryOffline) {
        logE2e('cache-podcast-offline', false, 'missing query or cachePodcastQueryOffline handler');
        return false;
      }
      savePodcastsEnabled(true);
      const saved = await handlers.cachePodcastQueryOffline(query);
      const rows = loadOfflinePodcastEpisodes();
      logE2e(
        'cache-podcast-offline',
        saved && rows.length > 0,
        \`query=\${query} saved=\${saved} offlineCount=\${rows.length}\`,
      );
      return saved && rows.length > 0;
    }
`;
if (!s.includes("case 'probe-offline-podcasts'")) {
  s = s.replace("    case 'probe-bridge': {", insert + "    case 'probe-bridge': {");
}
fs.writeFileSync(e2ePath, s);

let l = fs.readFileSync(layerPath, "utf8");
if (!l.includes("loadOfflinePodcastEpisodes")) {
  l = l.replace(
    "import { episodeEnvelope } from './podcastSearch';",
    "import { episodeEnvelope } from './podcastSearch';\nimport { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';\nimport { resolvePodcastEnvelopeForPlayback } from './podcastPlayback';\nimport { cacheEnvelopeForOffline, getStreamCacheEnvelope } from './streamCache';",
  );
}
const handlerBlock = `      playOfflinePodcast: async (index = 0, titleQuery) => {
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
        const cached = await getStreamCacheEnvelope(base);
        if (!cached?.url?.trim()) return false;
        const resolved = await resolvePodcastEnvelopeForPlayback(base);
        if (!resolved.url?.trim()) return false;
        await playEnvelopeRef.current(resolved, undefined, { autoPlay: true });
        return true;
      },
      cachePodcastQueryOffline: async (query) => {
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
      },`;
if (!l.includes("playOfflinePodcast:")) {
  l = l.replace("      playPodcastQuery: async (query) => {", handlerBlock + "\n      playPodcastQuery: async (query) => {");
}
fs.writeFileSync(layerPath, l);
console.log("patched sandboxLayer3 and e2eDevAction");
