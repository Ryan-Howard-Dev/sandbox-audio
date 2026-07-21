const fs = require("fs");
const layer = "C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx";
const e2e = "C:/Users/RH/Downloads/sovereign-music-console/src/e2eDevAction.ts";
const pods = "C:/Users/RH/Downloads/sovereign-music-console/src/stations/PodcastsView.tsx";

let s = fs.readFileSync(layer, "utf8");
const oldPod = `      playPodcastQuery: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(query, {
          catalogLimit: 8,
        });
        const localHit = localHits[0];
        if (localHit?.envelope?.url?.trim()) {
          return await playEnvelopeRef.current(localHit.envelope, undefined, { autoPlay: true });
        }
        const catalogHit = catalogHits[0];
        if (catalogHit?.envelope?.url?.trim()) {
          return await playEnvelopeRef.current(catalogHit.envelope, undefined, { autoPlay: true });
        }
        const show = catalogShows.find((s) =>
          s.title.toLowerCase().includes(query.toLowerCase().split(' ')[0] ?? ''),
        ) ?? catalogShows[0];
        if (!show) return false;
        const { subscription, episodes } = await subscribeFromCatalogShow(show);
        const ep = episodes[0];
        if (!ep?.audioUrl?.trim()) return false;
        return await playEnvelopeRef.current(
          episodeEnvelope(ep, subscription.title, subscription.artworkUrl),
          undefined,
          { autoPlay: true },
        );
      },`;

const newPod = `      playPodcastQuery: async (query) => {
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
              catalogHits.find((h) => (h.feedTitle ?? '').includes(episodeNum))
            );
          }
          const tokens = qLower.split(/\\s+/).filter((t) => t.length > 2);
          if (!tokens.length) return catalogHits[0];
          return catalogHits.find((h) => {
            const blob = \`\${h.feedTitle ?? ''} \${h.episode?.title ?? h.envelope?.title ?? ''}\`.toLowerCase();
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

if (!s.includes(oldPod)) throw new Error("playPodcastQuery block not found");
s = s.replace(oldPod, newPod);
if (!s.includes("shellBack: () => handleShellBack()")) {
  s = s.replace(
    "      openMobileNowPlaying: () => setMobileNowPlayingOpen(true),",
    "      shellBack: () => handleShellBack(),\n      openMobileNowPlaying: () => setMobileNowPlayingOpen(true),",
  );
}
fs.writeFileSync(layer, s);

let e = fs.readFileSync(e2e, "utf8");
if (!e.includes("shellBack?:")) {
  e = e.replace(
    "  reconcileFromNativePlayback?: () => Promise<boolean>;\n};",
    "  reconcileFromNativePlayback?: () => Promise<boolean>;\n  /** Hardware / UI back stack (Android). */\n  shellBack?: () => boolean;\n};",
  );
}
const marker = "    case 'collapse-now-playing': {";
const insertCases = `    case 'tap-mini-player': {
      const track = document.querySelector('.player-bar-track');
      if (!(track instanceof HTMLElement)) {
        logE2e('tap-mini-player', false, 'player-bar-track missing');
        return false;
      }
      track.click();
      await sleep(800);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const chrome = probeMobileHomeChrome();
      const pass = probe.expanded || chrome.nowPlayingOpen || chrome.shellNowPlayingClass;
      logE2e(
        'tap-mini-player',
        pass,
        \`expanded=\${probe.expanded} shellNp=\${chrome.shellNowPlayingClass} nowOpen=\${chrome.nowPlayingOpen}\`,
      );
      return pass;
    }
    case 'podcast-back-stress': {
      handlers.navigateTab?.('podcasts');
      await sleep(800);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'open-first-show' } }));
      await sleep(900);
      const backShow = handlers.shellBack?.() ?? false;
      await sleep(400);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'downloaded-tab' } }));
      await sleep(600);
      const backDownloaded = handlers.shellBack?.() ?? false;
      await sleep(400);
      window.dispatchEvent(new CustomEvent('sandbox-e2e-podcast-drill', { detail: { phase: 'discover-tab' } }));
      await sleep(600);
      const backDiscover = handlers.shellBack?.() ?? false;
      await sleep(400);
      handlers.openMobileNowPlaying?.();
      await sleep(700);
      const backNowPlaying = handlers.shellBack?.() ?? false;
      await sleep(500);
      const probe = handlers.getHeroVisualProbe?.() ?? probeHeroVisualFromDom();
      const pass = backShow && backDownloaded && backDiscover && backNowPlaying && !probe.expanded;
      logE2e(
        'podcast-back-stress',
        pass,
        \`show=\${backShow} downloaded=\${backDownloaded} discover=\${backDiscover} np=\${backNowPlaying} expanded=\${probe.expanded}\`,
      );
      return pass;
    }
`;
if (!e.includes("case 'tap-mini-player'")) {
  if (!e.includes(marker)) throw new Error("collapse marker missing");
  e = e.replace(marker, insertCases + marker);
}
fs.writeFileSync(e2e, e);

let p = fs.readFileSync(pods, "utf8");
const podMarker = "  useEffect(() => {\n    if (!drillBackRef) return;";
const podInsert = `  useEffect(() => {
    const onDrill = (event: Event) => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      if (phase === 'open-first-show') {
        selectTab('library');
        const feed = subscriptions[0];
        if (feed) openShow(feed.id);
      } else if (phase === 'downloaded-tab') {
        selectTab('library');
        setLibraryView('downloaded');
      } else if (phase === 'discover-tab') {
        selectTab('discover');
      }
    };
    window.addEventListener('sandbox-e2e-podcast-drill', onDrill);
    return () => window.removeEventListener('sandbox-e2e-podcast-drill', onDrill);
  }, [subscriptions, openShow, selectTab]);

`;
if (!p.includes("sandbox-e2e-podcast-drill")) {
  if (!p.includes(podMarker)) throw new Error("pod marker missing");
  p = p.replace(podMarker, podInsert + podMarker);
}
fs.writeFileSync(pods, p);
console.log("patched ok");
