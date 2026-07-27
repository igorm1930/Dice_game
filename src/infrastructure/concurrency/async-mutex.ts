import type { KeyedLock } from '../../core/ports/lock.port';

/**
 * In-process mutual exclusion, keyed by aggregate id.
 *
 * Implemented as a promise chain per key: each caller awaits the tail of the
 * chain for its key, then becomes the new tail. Callers for a given key are
 * therefore served strictly in arrival order, while different keys never block
 * each other.
 *
 * Entries are removed once a key's chain drains, so the map does not grow
 * without bound over the life of the process.
 */
export class AsyncMutex implements KeyedLock {
  private readonly chains = new Map<string, Promise<unknown>>();

  async withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();

    // `.then(() => task())` rather than `.then(task)` so a rejection in a prior
    // holder never propagates into this one — each caller is isolated.
    const current = previous.then(() => task());

    // The chain tail must never be a rejected promise: an unhandled rejection
    // here would crash the process under Node's default policy, and would also
    // poison every subsequent waiter on this key.
    const settled = current.then(
      () => undefined,
      () => undefined,
    );

    this.chains.set(key, settled);

    try {
      return await current;
    } finally {
      // Only clear if no later caller has since queued behind us.
      if (this.chains.get(key) === settled) {
        this.chains.delete(key);
      }
    }
  }

  /** Number of keys with an active or queued holder. Exposed for tests/metrics. */
  get size(): number {
    return this.chains.size;
  }
}
