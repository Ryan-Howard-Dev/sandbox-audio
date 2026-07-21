import { describe, expect, it } from 'vitest';
import {
  musicbrainzReleaseIdFromCredits,
  shouldReconcileLockerCoverWithMusicBrainz,
} from './albumCover';

const ESDEEKID_REBEL_CREDITS = JSON.stringify({
  musicbrainzReleaseId: 'f7c66e6a-d6b4-41c0-a770-bc4f30f9d98c',
  releaseTitle: 'Rebel',
  performers: ['EsDeeKid'],
});

describe('musicbrainzReleaseIdFromCredits', () => {
  it('reads release id from locker creditsJson', () => {
    expect(musicbrainzReleaseIdFromCredits(ESDEEKID_REBEL_CREDITS)).toBe(
      'f7c66e6a-d6b4-41c0-a770-bc4f30f9d98c',
    );
  });
});

describe('shouldReconcileLockerCoverWithMusicBrainz', () => {
  const releaseId = 'f7c66e6a-d6b4-41c0-a770-bc4f30f9d98c';
  const anneWilsonItunes =
    'https://is1-ssl.mzstatic.com/image/thumb/Music116/v4/bb/6d/c5/bb6dc5e3-8903-54ff-9576-32a054c96538/24UMGIM01523.rgb.jpg/600x600bb.jpg';
  const caaUrl = `https://coverartarchive.org/release/${releaseId}/front-500`;

  it('flags iTunes CDN art for reconciliation when MB id is known', () => {
    expect(shouldReconcileLockerCoverWithMusicBrainz(anneWilsonItunes, releaseId)).toBe(true);
  });

  it('skips reconciliation when art already references the MB release', () => {
    expect(shouldReconcileLockerCoverWithMusicBrainz(caaUrl, releaseId)).toBe(false);
  });

  it('reconciles missing art', () => {
    expect(shouldReconcileLockerCoverWithMusicBrainz(undefined, releaseId)).toBe(true);
  });
});
