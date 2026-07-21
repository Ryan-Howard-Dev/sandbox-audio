import { describe, expect, it, vi } from 'vitest';
import {
  LOCKER_REPAIR_USER_CONFIRMED,
  LOCKER_USER_DELETE_CONFIRMED,
  LockerDeleteBlockedError,
  assertLockerRepairDestructiveAllowed,
  assertLockerUserDeleteConfirmed,
  blockLockerAutoDelete,
} from './lockerDeleteGuard';

describe('lockerDeleteGuard', () => {
  it('requires user confirmation token for deletes', () => {
    expect(() => assertLockerUserDeleteConfirmed(undefined)).toThrow(LockerDeleteBlockedError);
    expect(() =>
      assertLockerUserDeleteConfirmed(LOCKER_USER_DELETE_CONFIRMED),
    ).not.toThrow();
  });

  it('blocks destructive repair without repair token', () => {
    expect(() =>
      assertLockerRepairDestructiveAllowed({ clearHollowRows: true }),
    ).toThrow(LockerDeleteBlockedError);
    expect(() =>
      assertLockerRepairDestructiveAllowed({
        clearHollowRows: true,
        userConfirmed: LOCKER_REPAIR_USER_CONFIRMED,
      }),
    ).not.toThrow();
  });

  it('throws on auto-delete paths in production', () => {
    vi.stubEnv('PROD', true);
    expect(() => blockLockerAutoDelete('pruneHollow')).toThrow(LockerDeleteBlockedError);
    vi.unstubAllEnvs();
  });
});
