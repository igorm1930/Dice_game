import { ConcurrencyConflictError } from '../../src/core/domain/errors';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';

describe('InMemoryPigGameRepository', () => {
  it('seeds a fresh game so load never has a missing-state branch', async () => {
    const repository = new InMemoryPigGameRepository();

    await expect(repository.load()).resolves.toMatchObject({
      totalScores: [0, 0],
      isPlaying: true,
      version: 0,
    });
  });

  it('save increments the version and round-trips the state', async () => {
    const repository = new InMemoryPigGameRepository();
    const current = await repository.load();

    const saved = await repository.save({ ...current, currentTurnScore: 7 });

    expect(saved.version).toBe(1);
    await expect(repository.load()).resolves.toMatchObject({
      currentTurnScore: 7,
      version: 1,
    });
  });

  it('rejects a write based on a stale snapshot', async () => {
    const repository = new InMemoryPigGameRepository();
    const stale = await repository.load();
    await repository.save({ ...stale, currentTurnScore: 4 });

    await expect(repository.save({ ...stale, currentTurnScore: 9 })).rejects.toThrow(
      ConcurrencyConflictError,
    );
  });

  it('does not expose a live reference to stored state', async () => {
    const repository = new InMemoryPigGameRepository();

    const snapshot = (await repository.load()) as { currentTurnScore: number };
    snapshot.currentTurnScore = 999;

    await expect(repository.load()).resolves.toMatchObject({ currentTurnScore: 0 });
  });
});
