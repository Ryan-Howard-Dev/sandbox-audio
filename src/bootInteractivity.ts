/**
 * Gate heavy vault / native work until the shell is interactive.
 * Releases on first pointer/touch/keydown or after 30s idle (whichever comes first).
 */

let uiInteractive = false;
let releaseScheduled = false;
const waiters = new Set<() => void>();

function releaseBootGate(): void {
  if (uiInteractive) return;
  uiInteractive = true;
  for (const resolve of waiters) resolve();
  waiters.clear();
}

/** True after first user interaction or the 30s boot idle timeout. */
export function isBootUiInteractive(): boolean {
  return uiInteractive;
}

/** Resolves when the UI is safe for heavy locker heal / native probes. */
export function whenBootUiInteractive(): Promise<void> {
  if (uiInteractive) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.add(resolve);
  });
}

/** Run work after first interaction or 30s idle — never blocks initial taps. */
export function runAfterBootInteractive(task: () => void | Promise<void>): void {
  void whenBootUiInteractive().then(() => task());
}

/** Device stress / E2E deep links — unblocks vault heal without waiting for idle timeout. */
export function markBootInteractiveFromAutomation(): void {
  releaseBootGate();
}

/** E2E-only: automation deep links count as "interactive" so probes can run after bootstrap. */
export function releaseBootGateForE2e(): void {
  releaseBootGate();
}

/** Install listeners once at app start (main.tsx). */
export function initBootInteractivityGate(): void {
  if (typeof window === 'undefined' || releaseScheduled) return;
  releaseScheduled = true;

  const onFirstInput = () => {
    for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.removeEventListener(event, onFirstInput, true);
    }
    releaseBootGate();
  };

  for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(event, onFirstInput, { capture: true, passive: true });
  }

  window.setTimeout(releaseBootGate, 30_000);
}
