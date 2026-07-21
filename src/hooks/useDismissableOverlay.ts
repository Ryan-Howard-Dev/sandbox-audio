import { useEffect, useRef } from 'react';

type SandboxOverlayHistoryState = {
  sandboxOverlay: true;
  sandboxOverlayDepth: number;
};

function readOverlayDepth(state: unknown): number {
  if (
    state &&
    typeof state === 'object' &&
    (state as SandboxOverlayHistoryState).sandboxOverlay === true &&
    typeof (state as SandboxOverlayHistoryState).sandboxOverlayDepth === 'number'
  ) {
    return (state as SandboxOverlayHistoryState).sandboxOverlayDepth;
  }
  return 0;
}

/** @internal exported for unit tests */
export function overlayDepthFromState(state: unknown): number {
  return readOverlayDepth(state);
}

function currentOverlayDepth(): number {
  if (typeof window === 'undefined') return 0;
  return readOverlayDepth(window.history.state);
}

/** True when the top history entry was pushed by {@link useDismissableOverlay}. */
export function isSandboxOverlayHistoryState(): boolean {
  return currentOverlayDepth() > 0;
}

/** Pop one dismissable overlay via browser history (returns false when nothing to pop). */
export function dismissSandboxOverlayHistory(): boolean {
  if (!isSandboxOverlayHistoryState()) return false;
  window.history.back();
  return true;
}

/** Prefer history pop for dismissable overlays; fall back when history was not pushed. */
export function closeSandboxOverlay(fallback: () => void): void {
  if (!dismissSandboxOverlayHistory()) {
    fallback();
  }
}

/**
 * Closes overlay on mobile/browser back (popstate).
 * Nested overlays use monotonic depth so closing a child does not dismiss its parent.
 */
export function useDismissableOverlay(open: boolean, onClose: () => void): void {
  const pushedRef = useRef(false);
  const depthRef = useRef(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) {
      if (pushedRef.current) {
        pushedRef.current = false;
        if (currentOverlayDepth() === depthRef.current) {
          window.history.back();
        }
      }
      return;
    }

    if (!pushedRef.current) {
      const nextDepth = currentOverlayDepth() + 1;
      depthRef.current = nextDepth;
      const state: SandboxOverlayHistoryState = {
        sandboxOverlay: true,
        sandboxOverlayDepth: nextDepth,
      };
      window.history.pushState(state, '');
      pushedRef.current = true;
    }

    const onPop = (event: PopStateEvent) => {
      if (!pushedRef.current) return;
      const newDepth = readOverlayDepth(event.state);
      if (newDepth < depthRef.current) {
        pushedRef.current = false;
        onCloseRef.current();
      }
    };

    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, [open]);
}
