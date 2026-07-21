const fs = require('fs');
const root = 'C:/Users/RH/Downloads/sovereign-music-console/src';

patch('downloadLockerPrecheck.ts', (s) => {
  if (s.includes('lockerEntryHasRecoverableAudio')) {
    s = s.replace('lockerEntryHasHealSignals', 'lockerEntryHasRecoverableAudio');
    return s;
  }
  return s;
});

patch('downloadQueue.ts', (s) => {
  const old = `    findLockerEntryForTrackIncludingHollow,
    findPlayableLockerEntryForTrack,
    lockerEntryHasHealSignals,
  } = await import('./lockerStorage');`;
  const neu = `    findLockerEntryForTrackIncludingHollow,
    findPlayableLockerEntryForTrack,
    lockerEntryHasRecoverableAudio,
  } = await import('./lockerStorage');`;
  if (!s.includes(old)) return s;
  s = s.replace(old, neu);
  s = s.replace(
    '(hollow ? await lockerEntryHasHealSignals(hollow.id) : false)',
    '(hollow ? await lockerEntryHasRecoverableAudio(hollow.id) : false)',
  );
  return s;
});

patch('lockerStorage.ts', (s) => {
  const anchor = `  if (/\\/ytdlp-playback\\//i.test(trimmed)) return false;
  return /^file:\\/\\//i.test(trimmed) || trimmed.startsWith('/');`;
  const neu = `  if (/\\/ytdlp-playback\\//i.test(trimmed)) return false;
  if (/\\/ytdlp-locker\\//i.test(trimmed)) return false;
  return /^file:\\/\\//i.test(trimmed) || trimmed.startsWith('/');`;
  if (!s.includes(anchor)) throw new Error('isStableNativeAudioPath anchor missing');
  return s.replace(anchor, neu);
});

// playLockerTrack: reacquire on missing audio
patch('sandboxLayer3.tsx', (s) => {
  const old = `        const locker = await ensureLockerPlayable(seed);
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) return false;
        return playEnvelopeRef.current(locker.envelope, undefined, { autoPlay: true });`;
  const neu = `        let locker = await ensureLockerPlayable(seed);
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
          const { attemptDeadLockerReacquire } = await import('./lockerDeadTrackReacquire');
          await attemptDeadLockerReacquire(trackTitle, artistName, albumTitle);
          locker = await ensureLockerPlayable(seed);
        }
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) return false;
        return playEnvelopeRef.current(locker.envelope, undefined, { autoPlay: true });`;
  if (!s.includes(old)) return s;
  return s.replace(old, neu);
});

function patch(file, fn) {
  const p = `${root}/${file}`;
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log('patched', file);
  }
}
