import { ConcurrencyConflictError } from '../../src/core/domain/errors';
import { PigGameOverError } from '../../src/core/domain/pig-game';
import { PigGameService } from '../../src/core/services/pig-game.service';
import { AsyncMutex } from '../../src/infrastructure/concurrency/async-mutex';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';
import { ScriptedRandomGenerator } from '../support/fakes';

function buildService(sequence: readonly number[] = [4]): {
  service: PigGameService;
  repository: InMemoryPigGameRepository;
} {
  const repository = new InMemoryPigGameRepository();
  const service = new PigGameService({
    repository,
    random: new ScriptedRandomGenerator(sequence),
    lock: new AsyncMutex(),
    config: { targetScore: 20 },
  });
  return { service, repository };
}

describe('PigGameService', () => {
  it('exposes the initial state', async () => {
    const { service } = buildService();

    await expect(service.getState()).resolves.toMatchObject({
      totalScores: [0, 0],
      activePlayer: 0,
      isPlaying: true,
    });
  });

  it('roll consumes exactly one die and persists the outcome', async () => {
    const { service } = buildService([5]);

    const state = await service.roll();

    expect(state.currentTurnScore).toBe(5);
    expect(state.lastRoll).toBe(5);
    expect(state.version).toBe(1);
  });

  it('rolling a 1 hands play to the other player', async () => {
    const { service } = buildService([6, 1]);

    await service.roll();
    const state = await service.roll();

    expect(state.currentTurnScore).toBe(0);
    expect(state.activePlayer).toBe(1);
  });

  it('hold banks and switches; reaching the target wins', async () => {
    const { service } = buildService([6, 6, 6, 6]);

    await service.roll();
    await service.roll();
    const mid = await service.hold(); // banks 12 -> still playing
    expect(mid).toMatchObject({ totalScores: [12, 0], activePlayer: 1, isPlaying: true });

    // Player 1 busts immediately? No — scripted sequence cycles 6s, so roll
    // twice and hold to bank 12 for player 1 as well.
    await service.roll();
    await service.roll();
    const p1 = await service.hold();
    expect(p1).toMatchObject({ totalScores: [12, 12], activePlayer: 0 });

    await service.roll();
    await service.roll();
    const finished = await service.hold(); // 12 + 12 = 24 >= 20 -> win

    expect(finished.isPlaying).toBe(false);
    expect(finished.winner).toBe(0);
    expect(finished.totalScores).toEqual([24, 12]);
  });

  it('rejects actions once the game is over', async () => {
    const { service } = buildService([6, 6, 6, 6]);
    for (let i = 0; i < 4; i += 1) {
      await service.roll();
    }
    await service.hold();

    await expect(service.roll()).rejects.toThrow(PigGameOverError);
    await expect(service.hold()).rejects.toThrow(PigGameOverError);
  });

  it('newGame resets play and is always allowed', async () => {
    const { service } = buildService([6, 6, 6, 6]);
    for (let i = 0; i < 4; i += 1) {
      await service.roll();
    }
    await service.hold();

    const fresh = await service.newGame();

    expect(fresh).toMatchObject({
      totalScores: [0, 0],
      currentTurnScore: 0,
      activePlayer: 0,
      isPlaying: true,
      winner: null,
      lastRoll: null,
    });
    // The reset is a guarded write like any other; history keeps advancing.
    expect(fresh.version).toBe(6);
  });

  /**
   * The lost-update regression test: five concurrent rolls must all land.
   * Without the lock, several would read the same version and all but one
   * roll would silently vanish.
   */
  it('serialises concurrent rolls without losing any', async () => {
    const { service } = buildService([2]); // constant 2s — never busts

    await Promise.all(Array.from({ length: 5 }, () => service.roll()));

    const state = await service.getState();
    expect(state.currentTurnScore).toBe(10);
    expect(state.version).toBe(5);
  });

  it('surfaces a version conflict from the repository as a loud error', async () => {
    const { service, repository } = buildService([2]);

    const stale = await repository.load();
    await service.roll(); // moves the stored version on

    await expect(repository.save(stale)).rejects.toThrow(ConcurrencyConflictError);
  });
});
