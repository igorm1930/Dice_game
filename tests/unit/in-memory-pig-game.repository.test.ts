import { ConcurrencyConflictError } from '../../src/core/domain/errors';
import { createPigGame } from '../../src/core/domain/pig-game';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';

function buildRepository(): InMemoryPigGameRepository {
  return new InMemoryPigGameRepository(createPigGame(100));
}

describe('InMemoryPigGameRepository', () => {
  it('serves the seeded state so load never has a missing-state branch', async () => {
    await expect(buildRepository().load()).resolves.toMatchObject({
      totalScores: [0, 0],
      isPlaying: true,
      targetScore: 100,
      version: 0,
    });
  });

  it('save increments the version and round-trips the state', async () => {
    const repository = buildRepository();
    const current = await repository.load();

    const saved = await repository.save({ ...current, currentTurnScore: 7 });

    expect(saved.version).toBe(1);
    await expect(repository.load()).resolves.toMatchObject({
      currentTurnScore: 7,
      version: 1,
    });
  });

  it('rejects a write based on a stale snapshot', async () => {
    const repository = buildRepository();
    const stale = await repository.load();
    await repository.save({ ...stale, currentTurnScore: 4 });

    await expect(repository.save({ ...stale, currentTurnScore: 9 })).rejects.toThrow(
      ConcurrencyConflictError,
    );
  });

  it('does not expose a live reference to stored or seeded state', async () => {
    const seed = createPigGame(100);
    const repository = new InMemoryPigGameRepository(seed);

    const snapshot = (await repository.load()) as { currentTurnScore: number };
    snapshot.currentTurnScore = 999;

    await expect(repository.load()).resolves.toMatchObject({ currentTurnScore: 0 });
  });
});
