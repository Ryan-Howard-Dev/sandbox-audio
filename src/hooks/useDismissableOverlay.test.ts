import { describe, expect, it } from 'vitest';
import { overlayDepthFromState } from './useDismissableOverlay';

describe('useDismissableOverlay depth', () => {
  it('reads stacked overlay depth from history state', () => {
    expect(overlayDepthFromState(null)).toBe(0);
    expect(overlayDepthFromState({ sandboxOverlay: true, sandboxOverlayDepth: 1 })).toBe(1);
    expect(overlayDepthFromState({ sandboxOverlay: true, sandboxOverlayDepth: 2 })).toBe(2);
  });

  it('child pop only dismisses when depth drops below its own', () => {
    const childDepth = 2;
    const parentDepth = 1;
    expect(overlayDepthFromState({ sandboxOverlay: true, sandboxOverlayDepth: 1 }) < childDepth).toBe(
      true,
    );
    expect(
      overlayDepthFromState({ sandboxOverlay: true, sandboxOverlayDepth: 1 }) < parentDepth,
    ).toBe(false);
  });
});
