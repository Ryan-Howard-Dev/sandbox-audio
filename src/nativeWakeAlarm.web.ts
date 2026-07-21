import { WebPlugin } from '@capacitor/core';
import type { WakeAlarmPlugin } from './nativeWakeAlarm';
import type { WakeAlarmTrack } from './sleepTimer';

export class WakeAlarmWeb extends WebPlugin implements WakeAlarmPlugin {
  async schedule(): Promise<{ scheduled: boolean; fireAtMs?: number }> {
    return { scheduled: false };
  }

  async cancel(): Promise<{ scheduled: boolean }> {
    return { scheduled: false };
  }

  async isScheduled(): Promise<{ scheduled: boolean; fireAtMs?: number }> {
    return { scheduled: false };
  }

  async consumePending(): Promise<{ pending: boolean; track?: WakeAlarmTrack }> {
    return { pending: false };
  }

  async addListener(): Promise<{ remove: () => Promise<void> }> {
    return { remove: async () => undefined };
  }
}
