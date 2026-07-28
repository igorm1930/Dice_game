import { ConcurrencyConflictError } from '../../src/core/domain/errors';
import { createPigGame, type PigGameState } from '../../src/core/domain/pig-game';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';

const PLAYERS = [
  { id: 'user-alice', username: 'alice' },
  { id: 'user-bob', username: 'bob' },
] as const;

function fresh(): PigGameState {
  return createPigGame(PLAYERS, 100);
}

async function seeded(): Promise<{
  repository: InMemoryPigGameRepository;
  state: PigGameState;
}> {
  const repository = new InMemoryPigGameRepository();
  const state = await repository.save(fresh());
  return { repository, state };
}

describe('InMemoryPigGameRepository', () => {
  it('starts empty — there is no match before two players sit down', async () => {
    await expect(new InMemoryPigGameRepository().load()).resolves.toBeNull();
  });

  it('accepts the first match and stamps it version 1', async () => {
    const { state } = await seeded();

    expect(state.version).toBe(1);
  });

  it('increments the version on every write', async () => {
    const { repository, state } = await seeded();

    const saved = await repository.save({ ...state, currentTurnScore: 7 });

    expect(saved.version).toBe(2);
    expect(saved.currentTurnScore).toBe(7);
  });

  it('rejects a write against a stale snapshot', async () => {
    const { repository, state } = await seeded();

    await repository.save({ ...state, currentTurnScore: 4 });

    await expect(repository.save({ ...state, currentTurnScore: 9 })).rejects.toThrow(
      ConcurrencyConflictError,
    );
  });

  it('rejects a second first-match write, so two concurrent new games cannot both land', async () => {
    const repository = new InMemoryPigGameRepository();

    await repository.save(fresh());

    await expect(repository.save(fresh())).rejects.toThrow(ConcurrencyConflictError);
  });

  it('isolates the caller from the stored snapshot on read', async () => {
    const { repository } = await seeded();

    const first = await repository.load();
    (first as { currentTurnScore: number }).currentTurnScore = 999;

    const second = await repository.load();
    expect(second?.currentTurnScore).toBe(0);
  });

  it('isolates the stored snapshot from the object it was handed', async () => {
    const { repository, state } = await seeded();

    const mutable = { ...state, currentTurnScore: 3 };
    await repository.save(mutable);
    mutable.currentTurnScore = 999;

    const reloaded = await repository.load();
    expect(reloaded?.currentTurnScore).toBe(3);
  });
});
