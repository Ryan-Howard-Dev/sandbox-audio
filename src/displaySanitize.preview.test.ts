import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./catalogDirect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalogDirect')>();
  return {
    ...actual,
    allowCatalogPreviewPlayback: vi.fn(() => false),
  };
});

import { allowCatalogPreviewPlayback } from './catalogDirect';
import {
  catalogPreviewDurationSeconds,
  displayTransportLabel,
} from './displaySanitize';

const PREVIEW_URL =
  'https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview/test.m4a';

describe('catalog preview display', () => {
  beforeEach(() => {
    vi.mocked(allowCatalogPreviewPlayback).mockReturnValue(false);
  });

  it('hides preview transport badge when preview playback is disabled', () => {
    expect(
      displayTransportLabel('https', 'element-src', PREVIEW_URL),
    ).toBeNull();
  });

  it('keeps full catalog duration in lists when tier34 is offline', () => {
    expect(
      catalogPreviewDurationSeconds(251, {
        previewUrl: PREVIEW_URL,
        fullStreamAvailable: false,
      }),
    ).toBe(251);
  });

  it('keeps full duration when tier34 can resolve full streams', () => {
    expect(
      catalogPreviewDurationSeconds(251, {
        previewUrl: PREVIEW_URL,
        fullStreamAvailable: true,
      }),
    ).toBe(251);
  });
});
