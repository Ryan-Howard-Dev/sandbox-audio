const fs = require("fs");
const p = "C:/Users/RH/Downloads/sovereign-music-console/src/e2eDevAction.ts";
let e = fs.readFileSync(p, "utf8");
if (!e.includes("loadSubscriptions")) {
  e = e.replace(
    "import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';",
    "import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';\nimport { loadSubscriptions } from './podcastStorage';",
  );
}
const old = `    case 'podcast-back-stress': {
      handlers.navigateTab?.('podcasts');
      await sleep(800);`;
const neu = `    case 'podcast-back-stress': {
      if (!loadSubscriptions().length && handlers.playPodcastQuery) {
        await handlers.playPodcastQuery('Joe Rogan Experience');
        await sleep(2500);
        handlers.closeMobileNowPlaying?.();
        handlers.pausePlayback?.();
        await sleep(600);
      }
      handlers.navigateTab?.('podcasts');
      await sleep(800);`;
if (!e.includes(neu)) {
  if (!e.includes(old)) throw new Error("back-stress block missing");
  e = e.replace(old, neu);
}
fs.writeFileSync(p, e);
console.log("ok");
