/**
 * Mutual exclusion over a logical key.
 *
 * Node's single thread does not make read-modify-write sequences atomic: any
 * `await` inside the critical section is a yield point where another request
 * can interleave. This port serialises access per aggregate id.
 *
 * The in-process implementation is correct for a single replica. Scaling out
 * would swap it for a distributed lock (e.g. Redis Redlock) behind this exact
 * interface — see ADR-0004.
 */
export interface KeyedLock {
  /**
   * Runs `task` with exclusive access to `key`. The lock is always released,
   * including when `task` rejects.
   */
  withLock<T>(key: string, task: () => Promise<T>): Promise<T>;
}
