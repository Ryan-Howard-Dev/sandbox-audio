import { describe, expect, it, vi } from 'vitest';

// The URL fallback resolves locker blobs; keep that out of these unit tests.
vi.mock('../nativeExoStreamResolver', () => ({
  resolveNativeExoStreamUrlAsync: vi.fn(async () => null),
}));

import type { MediaEnvelope } from '../sandboxLayer1';
import {
  envelopeIdFromExoMediaId,
  findQueueIndexForExoTransition,
  isExoMediaItemTransitionEvent,
} from './exoQueueSync';

function envelope(envelopeId: string, url: string): MediaEnvelope {
  return { envelopeId, url, title: envelopeId } as unknown as MediaEnvelope;
}

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

  it('parses the envelopeId out of a native mediaId', () => {
    expect(envelopeIdFromExoMediaId('env:locker-vultures-03')).toBe('locker-vultures-03');
    expect(envelopeIdFromExoMediaId('url:content://locker/track-1')).toBeNull();
    expect(envelopeIdFromExoMediaId(undefined)).toBeNull();
    expect(envelopeIdFromExoMediaId('env:')).toBeNull();
  });

  describe('findQueueIndexForExoTransition', () => {
    // Skipping across an album boundary is where URL matching broke: the queued URL is
    // rewritten (local proxy, signing, sb_client query) between enqueue and playback, so the
    // URI ExoPlayer reports back no longer equals the one JS registered.
    const queue = [
      envelope('locker-bully-09', 'content://locker/bully-09'),
      envelope('locker-vultures-01', 'content://locker/vultures-01'),
    ];

    it('matches on mediaId when the reported URL has been rewritten', async () => {
      const idx = await findQueueIndexForExoTransition(queue, {
        mediaId: 'env:locker-vultures-01',
        url: 'http://127.0.0.1:9999/proxy/abc?sb_client=test',
      });
      expect(idx).toBe(1);
    });

    it('falls back to the URL when the item carries no stable mediaId', async () => {
      const idx = await findQueueIndexForExoTransition(queue, {
        mediaId: 'url:content://locker/bully-09',
        url: 'content://locker/bully-09',
      });
      expect(idx).toBe(0);
    });

    it('returns -1 when neither the mediaId nor the URL is in the queue', async () => {
      const idx = await findQueueIndexForExoTransition(queue, {
        mediaId: 'env:not-queued',
        url: 'content://locker/not-queued',
      });
      expect(idx).toBe(-1);
    });
  });
});
