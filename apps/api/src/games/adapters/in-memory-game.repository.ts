import { Inject, Injectable } from '@nestjs/common';

import { type GameState } from '../../domain/game';
import { CLOCK, type Clock } from '../ports/clock.port';
import {
  type GameRepository,
  INITIAL_REVISION,
  type PersistedGame,
} from '../ports/game-repository.port';

/**
 * The in-memory store: a `Map`, and the same optimistic-concurrency contract
 * `MongoGameRepository` honours.
 *
 * It is a stand-in for persistence, not for the *guard*. `updateIfRevisionMatches`
 * really does compare-and-set here, so the conflict path is exercised by the
 * unit suite without a database. Because each write is a single synchronous
 * block between `await` points, two interleaved callers genuinely contend:
 * whichever reaches the map first wins and the other is told `null`.
 *
 * Production binds the Mongo adapter; this one stays because every games-service
 * test uses it, and requiring a running database to assert "a stale revision is
 * refused" would be a worse trade than keeping two implementations of a
 * three-method port in step.
 *
 * State is process-local, so it does not survive a restart and does not work
 * across instances. That is exactly what the Mongo adapter replaces, and nothing
 * above this file knows the difference.
 */
@Injectable()
export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, PersistedGame>();

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  findById(gameId: string): Promise<PersistedGame | null> {
    return Promise.resolve(this.games.get(gameId) ?? null);
  }

  create(state: GameState): Promise<PersistedGame> {
    const now = this.clock.now();
    const stored = persist({ ...state, revision: INITIAL_REVISION }, now, now);

    this.games.set(stored.id, stored);

    return Promise.resolve(stored);
  }

  updateIfRevisionMatches(
    gameId: string,
    expectedRevision: number,
    next: GameState,
  ): Promise<PersistedGame | null> {
    const current = this.games.get(gameId);

    // Both halves of the guard in one expression: an absent game has no
    // revision, so it can never match. The caller cannot tell "no such game"
    // from "somebody wrote first", and does not need to — either way its view is
    // stale and the action is not replayed.
    if (current?.revision !== expectedRevision) {
      return Promise.resolve(null);
    }

    const stored = persist(
      { ...next, revision: current.revision + 1 },
      // `createdAt` is written once and never again; a document that reset it on
      // every write would make "when did this match start" unanswerable.
      current.createdAt,
      this.clock.now(),
    );

    this.games.set(gameId, stored);

    return Promise.resolve(stored);
  }

  /** Empties the store. For tests and for local development, never for a request. */
  clear(): void {
    this.games.clear();
  }
}

/**
 * Freezes what goes into the map.
 *
 * The domain already freezes its own snapshots, but the spread above produces a
 * fresh outer object; without this a caller holding the returned value could
 * edit the stored document in place and walk straight past the revision guard.
 */
function persist(state: GameState, createdAt: Date, updatedAt: Date): PersistedGame {
  return Object.freeze({
    ...state,
    createdAt: new Date(createdAt.getTime()),
    updatedAt: new Date(updatedAt.getTime()),
  });
}
