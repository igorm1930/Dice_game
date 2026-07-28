import type { User } from '../domain/user';

/**
 * Persistence boundary for player identities.
 *
 * Same contract philosophy as the game repositories: the core depends on this
 * interface only, and the concrete store is named once in the composition root.
 * Swapping the in-memory Map for a `users` table is one line there (ADR-0001).
 */
export interface UserRepository {
  /**
   * Persists a new player.
   *
   * @throws {UsernameTakenError} if the case-folded username already exists.
   *   Uniqueness is enforced by the store, not by a check-then-write in the
   *   service — the latter is a race, and the race is the bug.
   */
  create(user: User): Promise<User>;

  /** Case-insensitive lookup. Returns `null` rather than throwing. */
  findByUsername(username: string): Promise<User | null>;

  findById(id: string): Promise<User | null>;

  /**
   * Increments the player's win counter and returns the updated record.
   * Returns `null` if the player no longer exists.
   */
  recordWin(userId: string): Promise<User | null>;
}
