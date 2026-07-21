const fs = require('fs');
const p = 'C:/Users/RH/Downloads/sovereign-music-console/src/sandboxLayer3.tsx';
let s = fs.readFileSync(p,'utf8');
const old = `        const locker = await ensureLockerPlayable(seed);
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) return false;`;
const neu = `        const locker = await ensureLockerPlayable(seed);
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
          await attemptDeadLockerReacquire(trackTitle, artistName, albumTitle);
          return false;
        }`;
if (!s.includes(old)) throw new Error('missing');
fs.writeFileSync(p, s.replace(old, neu));
