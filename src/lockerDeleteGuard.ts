/**
 * Hard kill switches for locker deletion — auto-delete paths throw in production;
 * user-initiated deletes require an explicit confirmation token from UI handlers.
 */

/** Pass from ConfirmDialog / delete handlers only after the user taps Delete. */
export const LOCKER_USER_DELETE_CONFIRMED = Symbol('locker-user-delete-confirmed');

/** Pass from Settings → Repair Locker destructive repair actions only. */
export const LOCKER_REPAIR_USER_CONFIRMED = Symbol('locker-repair-user-confirmed');

export class LockerDeleteBlockedError extends Error {
  constructor(message = 'Locker deletion blocked — user confirmation required') {
    super(message);
    this.name = 'LockerDeleteBlockedError';
  }
}

export function assertLockerUserDeleteConfirmed(
  userConfirmed?: symbol,
  context?: string,
): void {
  if (userConfirmed !== LOCKER_USER_DELETE_CONFIRMED) {
    const detail = context ? ` (${context})` : '';
    throw new LockerDeleteBlockedError(
      `Locker deletion blocked${detail} — user confirmation required`,
    );
  }
}

/** Blocks reconcile/repair paths that clear rows or drop blob-store keys. */
export function assertLockerRepairDestructiveAllowed(options?: {
  clearHollowRows?: boolean;
  deleteEmptyBlobs?: boolean;
  userConfirmed?: symbol;
}): void {
  if (!options?.clearHollowRows && !options?.deleteEmptyBlobs) return;
  if (options.userConfirmed !== LOCKER_REPAIR_USER_CONFIRMED) {
    throw new LockerDeleteBlockedError(
      'Locker repair destructive actions require explicit user confirmation',
    );
  }
}

/**
 * Auto-delete entry points (tombstones, prune, sync heal) must never run in production.
 * Dev builds log and return; production throws so agents cannot re-enable silently.
 */
export function blockLockerAutoDelete(operation: string): void {
  if (import.meta.env.PROD) {
    throw new LockerDeleteBlockedError(
      `Locker auto-delete permanently disabled: ${operation}`,
    );
  }
  console.warn(`[locker] auto-delete blocked (dev): ${operation}`);
}
