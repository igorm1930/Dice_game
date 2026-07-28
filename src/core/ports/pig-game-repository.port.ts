import type { PigGameState } from '../domain/pig-game';

/**
 * Persistence boundary for the shared Pig match.
 *
 * Same contract philosophy as {@link GameRepository}: the core depends on this
 * interface, the concrete store is named once in the composition root, and a
 * write against a stale snapshot must fail loudly rather than lose an update.
 */
export interface PigGameRepository {
  /**
   * Returns a snapshot of the current match, or `null` when none has been
   * started. Nullable rather than seeded because a match now names two real
   * authenticated players — there is no meaningful game before anyone logs in.
   */
  load(): Promise<PigGameState | null>;

  /**
   * Persists a new snapshot using `state.version` as an optimistic guard and
   * returns the stored snapshot with an incremented version.
   *
   * @throws {ConcurrencyConflictError} if the stored version has moved on.
   */
  save(state: PigGameState): Promise<PigGameState>;
}
