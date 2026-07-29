import { type GameState } from '../../domain/game';

/**
 * A game as it exists in storage: the domain aggregate, plus the two facts the
 * domain deliberately refuses to own.
 *
 * `createdAt`/`updatedAt` are stamped here because the domain is clock-free —
 * see the header of `src/domain/game.ts`. `revision` lives on `GameState`
 * because every transition has to carry it forward untouched, but **only this
 * layer ever changes it**: Mongo will increment it atomically inside the same
 * `findOneAndUpdate` that matches on it, and a domain that incremented it would
 * race with the very check that depends on it.
 */
export interface PersistedGame extends GameState {
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Where games live.
 *
 * A **port**: the games module states what it needs and nothing about how.
 * `MongoGameRepository` is bound in production; `InMemoryGameRepository` is what
 * the service and domain suites run against. Swapping one for the other was a
 * single line in `games.module.ts` and no other file changed.
 *
 * The shape is chosen for optimistic concurrency now rather than later, because
 * retrofitting it is the kind of change that quietly leaves one write path
 * unguarded. There is no `update(state)` and there never should be: a caller
 * that could write without naming the revision it read is a lost update waiting
 * to happen.
 */
export interface GameRepository {
  /** The stored game, or `null` when no game has that id. */
  findById(gameId: string): Promise<PersistedGame | null>;

  /**
   * Persists a newly created game, stamping both timestamps and setting the
   * initial revision. The `revision` on the argument is ignored — this layer
   * owns it.
   */
  create(state: GameState): Promise<PersistedGame>;

  /**
   * Writes `next` **only if** the stored document is still at
   * `expectedRevision`, incrementing the revision as it does.
   *
   * Returns `null` when nothing matched — either the game is gone or somebody
   * else wrote first. That `null` is the entire conflict signal: the caller maps
   * it to `GAME_REVISION_CONFLICT` and does **not** replay the action. It is
   * what makes a double-clicked Roll produce one roll, and what makes two seats
   * on one page safe without any live synchronisation.
   *
   * Implementations must make the compare-and-set atomic. In Mongo that is one
   * `findOneAndUpdate({ _id, revision }, { $set: …, $inc: { revision: 1 } })`;
   * a read-then-write pair here would reintroduce exactly the race this exists
   * to close.
   */
  updateIfRevisionMatches(
    gameId: string,
    expectedRevision: number,
    next: GameState,
  ): Promise<PersistedGame | null>;
}

/**
 * DI token for {@link GameRepository}.
 *
 * ```ts
 * // games.module.ts:
 * { provide: GAME_REPOSITORY, useClass: MongoGameRepository }
 * ```
 */
export const GAME_REPOSITORY = 'GAME_REPOSITORY';

/** The revision a game is stored at before anything has been applied to it. */
export const INITIAL_REVISION = 0;
