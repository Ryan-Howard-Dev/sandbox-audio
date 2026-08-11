/**
 * The triggers: app opened, window focused, timer fired, something changed locally.
 *
 * Deliberately thin. Every judgement about whether to actually sync is in lockerSyncSchedule, so
 * this can fire freely and often — focus in particular arrives on every alt-tab — and the decision
 * is made in one tested place rather than by four different guards written at four call sites.
 */

import { useEffect } from 'react';
import { runLockerSync } from '../lockerSyncEngine';
import { INTERVAL_MS } from '../lockerSyncSchedule';
import { subscribeLockerCache } from '../lockerStorage';
import { subscribePhysicalCollection } from '../physicalCollectionStore';

export function useShellLockerSync(): void {
  useEffect(() => {
    void runLockerSync('startup');

    const onFocus = () => void runLockerSync('focus');
    const onVisible = () => {
      // visibilitychange is what fires on a phone; focus is what fires on a desktop. Both, because
      // a phone returning from the lock screen never raises focus.
      if (document.visibilityState === 'visible') void runLockerSync('focus');
    };
    const onOnline = () => void runLockerSync('focus');

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    const timer = window.setInterval(() => void runLockerSync('interval'), INTERVAL_MS);

    /*
     * Local edits, from the two stores that hold anything the manifest carries. Fired on every
     * change and debounced by the scheduler, so renaming eight tracks is one push rather than
     * eight, without this file knowing anything about timing.
     */
    const unsubscribeLocker = subscribeLockerCache(() => void runLockerSync('change'));
    const unsubscribeCollection = subscribePhysicalCollection(
      () => void runLockerSync('change'),
    );

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.clearInterval(timer);
      unsubscribeLocker();
      unsubscribeCollection();
    };
  }, []);
}
