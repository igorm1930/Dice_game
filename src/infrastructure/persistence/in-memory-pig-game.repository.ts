import { ConcurrencyConflictError } from '../../core/domain/errors';
import type { PigGameState } from '../../core/domain/pig-game';
import type { PigGameRepository } from '../../core/ports/pig-game-repository.port';

/** Stable aggregate id used in concurrency-conflict diagnostics. */
const AGGREGATE_ID = 'pig-game';

/**
 * In-memory adapter for {@link PigGameRepository}.
 *
 * Holds at most one match — the table is empty until two authenticated players
 * sit down. The two properties that legitimise the other in-memory repository
 * apply here too: snapshot isolation on every boundary crossing, and
 * version-guarded writes (see ADR-0001, ADR-0004).
 */
export class InMemoryPigGameRepository implements PigGameRepository {
  private state: PigGameState | null = null;

  load(): Promise<PigGameState | null> {
    return Promise.resolve(this.state === null ? null : structuredClone(this.state));
  }

  save(next: PigGameState): Promise<PigGameState> {
    // The first match of the process is written against version 0, which is
    // exactly what `createPigGame` produces — so a fresh table needs no
    // special case, and a *second* concurrent "new game" still conflicts.
    const currentVersion = this.state?.version ?? 0;

    if (next.version !== currentVersion) {
      return Promise.reject(
        new ConcurrencyConflictError(AGGREGATE_ID, next.version, currentVersion),
      );
    }

    this.state = structuredClone({ ...next, version: next.version + 1 });
    return Promise.resolve(structuredClone(this.state));
  }
}
