const fs = require('fs');
const p = 'C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx';
let t = fs.readFileSync(p, 'utf8');
const start = t.indexOf('        const guestTokens = qLower');
const end = t.indexOf('        const { catalogShows, catalogHits, localHits }', start);
if (start < 0 || end < 0) throw new Error('anchors not found');
const replacement = `        const guestTokens = qLower
          .split(/\\s+/)
          .filter((t) => t.length > 2 && !/^\\d{3,5}$/.test(t));
`;
t = t.slice(0, start) + replacement + t.slice(end);
t = t.replace(
  '(!episodeNum || localTitle.includes(episodeNum)) &&\n          !guestTokens.length;',
  '(!episodeNum || localTitle.includes(episodeNum)) &&\n          guestTokens.length < 2;',
);
fs.writeFileSync(p, t);
console.log('playPodcastQuery simplified');
