import { describe, expect, it } from 'vitest';
import { isExoMediaItemTransitionEvent } from './exoQueueSync';

describe('exoQueueSync', () => {
  it('detects media item transition events with url', () => {
    expect(
      isExoMediaItemTransitionEvent({
        event: 'mediaItemTransition',
        url: 'content://locker/track-1',
        index: 1,
      }),
    ).toBe(true);
    expect(isExoMediaItemTransitionEvent({ event: 'ended' })).toBe(false);
    expect(isExoMediaItemTransitionEvent(null)).toBe(false);
  });
});
