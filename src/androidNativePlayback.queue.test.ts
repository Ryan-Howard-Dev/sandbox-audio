import { describe, expect, it } from 'vitest';
import { isNativeExoQueueEndedEvent, type NativeExoPlaybackEvent } from './androidNativePlayback';

describe('native exo queue events', () => {
  it('recognizes queueEnded playback events', () => {
    const evt: NativeExoPlaybackEvent = { event: 'queueEnded', index: 0, queueLength: 1 };
    expect(isNativeExoQueueEndedEvent(evt)).toBe(true);
  });

  it('rejects mediaItemTransition events', () => {
    const evt: NativeExoPlaybackEvent = {
      event: 'mediaItemTransition',
      url: 'content://track',
    };
    expect(isNativeExoQueueEndedEvent(evt)).toBe(false);
  });
});
