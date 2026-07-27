import { ConcurrencyConflictError } from '../../core/domain/errors';
import { createPigGame, type PigGameState } from '../../core/domain/pig-game';
import type { PigGameRepository } from '../../core/ports/pig-game-repository.port';

/** Stable aggregate id used in concurrency-conflict diagnostics. */
const AGGREGATE_ID = 'pig-game';

/**
 * In-memory adapter for {@link PigGameRepository}.
 *
 * Holds exactly one state, seeded at construction so `load()` never has a
 * missing-state branch. The same two properties that legitimise the other
 * in-memory repository apply here: snapshot isolation on every boundary
 * crossing, and version-guarded writes (see ADR-0001, ADR-0004).
 */
export class InMemoryPigGameRepository implements PigGameRepository {
  private state: PigGameState = createPigGame();

  load(): Promise<PigGameState> {
    return Promise.resolve(structuredClone(this.state));
  }

  save(next: PigGameState): Promise<PigGameState> {
    if (next.version !== this.state.version) {
      return Promise.reject(
        new ConcurrencyConflictError(AGGREGATE_ID, next.version, this.state.version),
      );
    }

    this.state = structuredClone({ ...next, version: next.version + 1 });
    return Promise.resolve(structuredClone(this.state));
  }
}
