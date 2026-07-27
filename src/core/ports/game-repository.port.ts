import type { Game } from '../domain/game';

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Persistence boundary for the Game aggregate.
 *
 * The application core depends only on this interface. The concrete store —
 * an in-memory Map today, PostgreSQL the day persistence is a requirement — is
 * chosen once in the composition root and nowhere else.
 *
 * Note the absence of any query-builder or ORM type in this signature. A
 * repository that leaks its driver's types is not an abstraction, it is a
 * rename.
 */
export interface GameRepository {
  /**
   * Persists a brand new aggregate.
   *
   * @throws if an aggregate with the same id already exists.
   */
  create(game: Game): Promise<Game>;

  findById(id: string): Promise<Game | null>;

  /**
   * Persists a new snapshot of an existing aggregate using `game.version` as an
   * optimistic guard, returning the stored snapshot with an incremented version.
   *
   * @throws {ConcurrencyConflictError} if the stored version has moved on.
   * @throws {GameNotFoundError} if the aggregate no longer exists.
   */
  update(game: Game): Promise<Game>;

  findAll(page: PageRequest): Promise<Page<Game>>;

  /**
   * Completed games ordered by descending score. Ties are broken by earliest
   * completion so the leaderboard is stable across calls.
   */
  findLeaderboard(limit: number): Promise<readonly Game[]>;
}
