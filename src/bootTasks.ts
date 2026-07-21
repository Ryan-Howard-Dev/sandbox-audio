/** Fire-and-forget boot task with logged rejection (avoids unhandled promise crashes). */
export function safeBoot(label: string, task: () => void | Promise<unknown>): void {
  try {
    const result = task();
    if (result && typeof (result as Promise<void>).then === 'function') {
      void (result as Promise<void>).catch((err: unknown) => {
        console.warn(`[Sandbox] boot task failed (${label}):`, err);
      });
    }
  } catch (err) {
    console.warn(`[Sandbox] boot task failed (${label}):`, err);
  }
}
