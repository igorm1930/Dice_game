import { ConcurrencyConflictError, GameNotFoundError } from '../../core/domain/errors';
import { GameStatus, type Game } from '../../core/domain/game';
import type { GameRepository, Page, PageRequest } from '../../core/ports/game-repository.port';

/**
 * In-memory adapter for {@link GameRepository}.
 *
 * Chosen deliberately over a database for this scope — see ADR-0001. The two
 * properties that make it a legitimate implementation rather than a stub:
 *
 *  1. **Snapshot isolation.** Every value crossing the boundary is deep-cloned.
 *     Handing out a live reference would let a caller mutate "persisted" state
 *     without going through `update()`, which no real datastore permits and
 *     which would let bugs pass tests that a database would have caught.
 *
 *  2. **Optimistic concurrency.** Writes are guarded by a version check, so a
 *     lost update surfaces as a loud conflict instead of silent data loss.
 *
 * The known limitation is stated plainly: state is process-local and does not
 * survive a restart or a second replica.
 */
export class InMemoryGameRepository implements GameRepository {
  private readonly games = new Map<string, Game>();

  create(game: Game): Promise<Game> {
    if (this.games.has(game.id)) {
      return Promise.reject(
        new Error(`Cannot create game '${game.id}': an aggregate with that id already exists.`),
      );
    }

    const stored = snapshot(game);
    this.games.set(stored.id, stored);
    return Promise.resolve(snapshot(stored));
  }

  findById(id: string): Promise<Game | null> {
    const found = this.games.get(id);
    return Promise.resolve(found ? snapshot(found) : null);
  }

  update(game: Game): Promise<Game> {
    const existing = this.games.get(game.id);

    if (!existing) {
      return Promise.reject(new GameNotFoundError(game.id));
    }

    if (existing.version !== game.version) {
      return Promise.reject(new ConcurrencyConflictError(game.id, game.version, existing.version));
    }

    const stored = snapshot({ ...game, version: game.version + 1 });
    this.games.set(stored.id, stored);
    return Promise.resolve(snapshot(stored));
  }

  findAll(page: PageRequest): Promise<Page<Game>> {
    // Newest first — the only ordering a client of a "list games" endpoint
    // reasonably expects, and stable because ids are unique.
    const all = [...this.games.values()].sort(byCreatedAtDesc);
    const items = all.slice(page.offset, page.offset + page.limit).map(snapshot);

    return Promise.resolve({
      items,
      total: all.length,
      limit: page.limit,
      offset: page.offset,
    });
  }

  findLeaderboard(limit: number): Promise<readonly Game[]> {
    const ranked = [...this.games.values()]
      .filter((game) => game.status === GameStatus.COMPLETED)
      .sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
          return b.totalScore - a.totalScore;
        }
        // Deterministic tie-break: whoever finished first ranks higher.
        return (a.completedAt ?? '').localeCompare(b.completedAt ?? '');
      })
      .slice(0, limit)
      .map(snapshot);

    return Promise.resolve(ranked);
  }

  /** Test/maintenance affordance. Intentionally absent from the port. */
  clear(): void {
    this.games.clear();
  }

  get size(): number {
    return this.games.size;
  }
}

function byCreatedAtDesc(a: Game, b: Game): number {
  const byDate = b.createdAt.localeCompare(a.createdAt);
  return byDate !== 0 ? byDate : b.id.localeCompare(a.id);
}

/**
 * Deep copy across the persistence boundary, emulating what serialisation to a
 * real datastore would do for free.
 */
function snapshot(game: Game): Game {
  return structuredClone(game);
}
