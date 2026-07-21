import { describe, expect, it } from 'vitest';
import {
  shouldCollapseFromDownwardPan,
  shouldExpandFromUpwardPan,
  verticalPanVelocity,
} from './verticalPanGesture';

describe('verticalPanGesture', () => {
  it('expands on upward swipe past threshold', () => {
    expect(shouldExpandFromUpwardPan(-60, 0)).toBe(true);
    expect(shouldExpandFromUpwardPan(-30, 0)).toBe(false);
  });

  it('expands on fast upward flick', () => {
    expect(shouldExpandFromUpwardPan(-30, -0.6)).toBe(true);
  });

  it('collapses on downward swipe past threshold', () => {
    expect(shouldCollapseFromDownwardPan(120, 0)).toBe(true);
    expect(shouldCollapseFromDownwardPan(50, 0)).toBe(false);
  });

  it('collapses on fast downward flick', () => {
    expect(shouldCollapseFromDownwardPan(50, 0.55)).toBe(true);
  });

  it('computes velocity safely for zero elapsed', () => {
    expect(verticalPanVelocity(10, 0)).toBe(10);
  });
});
