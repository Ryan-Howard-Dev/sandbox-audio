import { describe, expect, it } from 'vitest';
import {
  findLockerDurationIdentitySuspects,
  verifyAcquisitionCandidate,
} from './acquisitionIdentity';
import { MOBILE_DURATION_MAX_RATIO, MOBILE_DURATION_MIN_RATIO } from './catalogIdentityMatch';

/*
 * Device report: Donda stored a live cut; Vultures 1 stored an unrelated cover. Play-time gates
 * never ran — the wrong file was already in the vault. These assert the pre-store check rejects
 * both shapes with an actionable reason (no silent skip).
 */
describe('verifyAcquisitionCandidate — before locker store', () => {
  const catalog = {
    title: 'Vultures',
    artist: '¥$, Kanye West, Ty Dolla $ign',
    album: 'Vultures 1',
    durationSeconds: 278,
  };

  it('rejects a live recording offered for a studio catalog track', () => {
    const verdict = verifyAcquisitionCandidate(catalog, {
      title: 'Vultures (Live at Rolling Loud)',
      artist: 'Kanye West',
      durationSeconds: 280,
      url: 'https://www.youtube.com/watch?v=live1',
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) {
      expect(verdict.reason).toMatch(/unrequested rendition/i);
    }
  });

  it('rejects a candidate whose title bears no relation to the requested one', () => {
    const verdict = verifyAcquisitionCandidate(catalog, {
      title: 'Random Jazz Fusion Number Seven',
      artist: 'Studio Session Channel',
      durationSeconds: 260,
      url: 'https://www.youtube.com/watch?v=other1',
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) {
      expect(verdict.reason).toMatch(/title unrelated/i);
    }
  });

  it('rejects when the candidate echoes catalog metadata with nothing independent', () => {
    const verdict = verifyAcquisitionCandidate(catalog, {
      title: catalog.title,
      artist: catalog.artist,
      durationSeconds: catalog.durationSeconds,
      url: 'https://example.com/audio.m4a',
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) {
      expect(verdict.reason).toMatch(/no independent metadata/i);
    }
  });

  it('accepts a decorated studio hit with matching duration', () => {
    const verdict = verifyAcquisitionCandidate(catalog, {
      title: '¥$ - Vultures (Official Audio)',
      artist: 'YouTube',
      durationSeconds: 275,
      url: 'https://www.youtube.com/watch?v=studio1',
    });
    expect(verdict).toEqual({ ok: true });
  });
});

describe('findLockerDurationIdentitySuspects — repair detection', () => {
  it('flags stored duration outside mobile ratio bounds without deleting', () => {
    const catalogDur = 200;
    const tooLong = Math.ceil(catalogDur * MOBILE_DURATION_MAX_RATIO) + 10;
    const suspects = findLockerDurationIdentitySuspects(
      [
        {
          id: 'locker-1',
          title: 'Hurricane',
          artist: 'Kanye West',
          albumName: 'Donda',
          durationSeconds: tooLong,
        },
      ],
      [
        {
          title: 'Hurricane',
          artist: 'Kanye West',
          albumName: 'Donda',
          durationSeconds: catalogDur,
        },
      ],
    );
    expect(suspects).toHaveLength(1);
    expect(suspects[0]?.reason).toMatch(/diverges from catalog/);
    expect(suspects[0]?.entryId).toBe('locker-1');
  });

  it('does not flag durations within the mobile ratio window', () => {
    const catalogDur = 200;
    const okDur = Math.floor(catalogDur * ((MOBILE_DURATION_MIN_RATIO + MOBILE_DURATION_MAX_RATIO) / 2));
    const suspects = findLockerDurationIdentitySuspects(
      [
        {
          id: 'locker-2',
          title: 'Jail',
          artist: 'Kanye West',
          albumName: 'Donda',
          durationSeconds: okDur,
        },
      ],
      [{ title: 'Jail', artist: 'Kanye West', albumName: 'Donda', durationSeconds: catalogDur }],
    );
    expect(suspects).toHaveLength(0);
  });
});
