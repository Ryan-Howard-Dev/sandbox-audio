import { describe, expect, it } from 'vitest';
import {
  durationDivergesFromCatalog,
  durationSuspectForRepair,
} from './catalogIdentityMatch';
import { findLockerDurationIdentitySuspects } from './acquisitionIdentity';

/*
 * Measured against a real locker. A wrong recording was stored under the correct title at 276s
 * where the catalog track runs 216s. The download gate's band (0.7-1.4) puts that ratio at 1.28,
 * inside the accepted range, so nothing flagged it -- and the repair, which shared those
 * thresholds, was blind to exactly the case it exists for.
 */
const CATALOG = 216;
const STORED_WRONG = 276;

describe('repair band is stricter than the download gate', () => {
  it('the gate accepts the wrong file, which is why it was stored', () => {
    expect(durationDivergesFromCatalog(CATALOG, STORED_WRONG)).toBe(false);
  });

  it('the repair band flags it', () => {
    expect(durationSuspectForRepair(CATALOG, STORED_WRONG)).toBe(true);
  });

  it('leaves ordinary variation alone', () => {
    // Remasters and pressings differ by a second or two; that is not a wrong file.
    expect(durationSuspectForRepair(216, 218)).toBe(false);
    expect(durationSuspectForRepair(216, 210)).toBe(false);
  });

  it('abstains where it has no basis, exactly as the gate does', () => {
    expect(durationSuspectForRepair(0, 276)).toBe(false);
    expect(durationSuspectForRepair(216, 0)).toBe(false);
    expect(durationSuspectForRepair(30, 45)).toBe(false); // too short to judge
  });
});

describe('findLockerDurationIdentitySuspects surfaces the real case', () => {
  const entries = [
    { id: 'a', title: 'VULTURES', artist: 'Kanye West', albumName: 'VULTURES 1', durationSeconds: STORED_WRONG },
    { id: 'b', title: 'PAID', artist: 'Kanye West', albumName: 'VULTURES 1', durationSeconds: 195 },
  ];
  const hints = [
    { title: 'VULTURES', artist: 'Kanye West', albumName: 'VULTURES 1', durationSeconds: CATALOG },
    { title: 'PAID', artist: 'Kanye West', albumName: 'VULTURES 1', durationSeconds: 197 },
  ];

  it('flags the diverging row and only that row', () => {
    const suspects = findLockerDurationIdentitySuspects(entries, hints);
    expect(suspects.map((s) => s.entryId)).toEqual(['a']);
    expect(suspects[0]!.storedDurationSeconds).toBe(STORED_WRONG);
    expect(suspects[0]!.catalogDurationSeconds).toBe(CATALOG);
  });
});
