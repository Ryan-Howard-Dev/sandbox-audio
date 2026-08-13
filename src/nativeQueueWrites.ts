/**
 * Who is still allowed to add to the native player's queue.
 *
 * Two things fill that queue: prefetch, which covers the next few positions, and priming, which
 * walks the rest. Both resolve asynchronously, and native Exo takes queue order from the order the
 * calls arrive in, so a run that is still resolving when the queue is rebuilt underneath it will
 * append its late results to the new queue in whatever order they finish.
 *
 * That is what skipping did. Playing a track resets the native queue, and the prefetch run for the
 * position the listener just left was still in flight; its results landed after the reset and
 * before the replacement run had started, so the ordering guard inside each run could not see the
 * problem -- each run was internally in order, they were just writing to a queue that no longer
 * meant what they thought. Measured on device: two skips left the player holding positions
 * 0, 4, 2, 5, 3, 1 where it should have held 0 to 5, and because enqueueing deduplicates, that
 * order then stuck for the rest of the session.
 *
 * So the reset is made authoritative. Anything holding a token from before it stops writing.
 *
 * Its own module, with no imports, because both the playback layer that resets the queue and the
 * prefetch layer that writes to it need it, and anything larger would make those two import each
 * other.
 */

let generation = 0;

/** Take a token before starting to write. Pass it back to ask whether the work still counts. */
export function currentNativeQueueWriteGeneration(): number {
  return generation;
}

/**
 * Abandon every in-flight write. Call when the native queue is reset or replaced.
 *
 * Cheap and safe to call more often than strictly needed: the cost of a spurious call is that a
 * run re-primes, and the cost of a missing one is a queue in the wrong order for the rest of the
 * session.
 */
export function abandonNativeQueueWrites(): void {
  generation += 1;
}

/** True when the queue has been reset since this token was taken. */
export function nativeQueueWritesSuperseded(token: number): boolean {
  return token !== generation;
}
