import { describe, expect, it, beforeEach } from 'vitest';
import {
  flushPendingShellScrollRestore,
  registerShellScrollContainer,
  requestShellScrollRestore,
  restoreShellScroll,
  saveShellScroll,
  SEARCH_RESULTS_SCROLL_KEY,
} from './scrollRestore';

function mockScrollContainer(scrollTop = 0) {
  let top = scrollTop;
  const el = {
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      top = value;
    },
  } as HTMLElement;
  registerShellScrollContainer(el);
  return {
    el,
    getTop: () => top,
    setTop: (value: number) => {
      top = value;
    },
  };
}

describe('scrollRestore', () => {
  beforeEach(() => {
    registerShellScrollContainer(null);
  });

  it('saves and restores shell scroll positions by key', () => {
    const container = mockScrollContainer(240);
    saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
    container.setTop(0);
    expect(restoreShellScroll(SEARCH_RESULTS_SCROLL_KEY)).toBe(true);
    expect(container.getTop()).toBe(240);
  });

  it('flushes pending restore after navigation', () => {
    const container = mockScrollContainer(480);
    saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
    container.setTop(0);
    requestShellScrollRestore(SEARCH_RESULTS_SCROLL_KEY);
    flushPendingShellScrollRestore();
    expect(container.getTop()).toBe(480);
  });
});
