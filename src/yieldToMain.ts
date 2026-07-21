/** Yield the JS main thread so the UI can paint between heavy work items. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const schedule =
      typeof globalThis !== 'undefined' && typeof (globalThis as { setTimeout?: typeof setTimeout }).setTimeout === 'function'
        ? (globalThis as { setTimeout: typeof setTimeout }).setTimeout
        : null;
    if (schedule) {
      schedule(resolve, 0);
      return;
    }
    resolve();
  });
}
