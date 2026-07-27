import { ConcurrencyConflictError } from '../../src/core/domain/errors';
import {
  InvalidTargetScoreError,
  PigGameOverError,
  createPigGame,
} from '../../src/core/domain/pig-game';
import { PigGameService } from '../../src/core/services/pig-game.service';
import { AsyncMutex } from '../../src/infrastructure/concurrency/async-mutex';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';
import { ScriptedRandomGenerator } from '../support/fakes';

const DEFAULT_TARGET = 20;

function buildService(sequence: readonly number[] = [4]): {
  service: PigGameService;
  repository: InMemoryPigGameRepository;
} {
  const repository = new InMemoryPigGameRepository(createPigGame(DEFAULT_TARGET));
  const service = new PigGameService({
    repository,
    random: new ScriptedRandomGenerator(sequence),
    lock: new AsyncMutex(),
    config: { defaultTargetScore: DEFAULT_TARGET },
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
      targetScore: DEFAULT_TARGET,
    });
  });

  it('roll consumes exactly one die and persists the outcome', async () => {
    const { service } = buildService([5]);

    const state = await service.roll();

    expect(state.currentTurnScore).toBe(5);
    expect(state.lastRoll).toBe(5);
    expect(state.version).toBe(1);
  });

  it('rolling a 6 busts and hands play to the other player', async () => {
    const { service } = buildService([5, 6]);

    await service.roll();
    const state = await service.roll();

    expect(state.currentTurnScore).toBe(0);
    expect(state.activePlayer).toBe(1);
  });

  it('hold banks and switches; reaching the target wins', async () => {
    // Scripted 5s cycle: each turn banks 10 after two rolls.
    const { service } = buildService([5]);

    await service.roll();
    await service.roll();
    const mid = await service.hold(); // P0 banks 10 -> still playing
    expect(mid).toMatchObject({ totalScores: [10, 0], activePlayer: 1, isPlaying: true });

    await service.roll();
    await service.roll();
    const p1 = await service.hold(); // P1 banks 10
    expect(p1).toMatchObject({ totalScores: [10, 10], activePlayer: 0 });

    await service.roll();
    await service.roll();
    const finished = await service.hold(); // 10 + 10 = 20 >= 20 -> win

    expect(finished.isPlaying).toBe(false);
    expect(finished.winner).toBe(0);
    expect(finished.totalScores).toEqual([20, 10]);
  });

  it('rejects actions once the game is over', async () => {
    const { service } = buildService([5]);
    for (let i = 0; i < 4; i += 1) {
      await service.roll();
    }
    await service.hold(); // banks 20 -> win

    await expect(service.roll()).rejects.toThrow(PigGameOverError);
    await expect(service.hold()).rejects.toThrow(PigGameOverError);
  });

  it('newGame resets play using the default target', async () => {
    const { service } = buildService([5]);
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
      targetScore: DEFAULT_TARGET,
    });
    // The reset is a guarded write like any other; history keeps advancing.
    expect(fresh.version).toBe(6);
  });

  it('newGame honours a chosen target for the whole match', async () => {
    const { service } = buildService([5]);

    const fresh = await service.newGame(10);
    expect(fresh.targetScore).toBe(10);

    await service.roll();
    await service.roll();
    const finished = await service.hold(); // 10 >= 10 -> win at the chosen target

    expect(finished.winner).toBe(0);
  });

  it('rejects an unplayable target with a domain error', async () => {
    const { service } = buildService();

    await expect(service.newGame(1)).rejects.toThrow(InvalidTargetScoreError);
    await expect(service.newGame(5000)).rejects.toThrow(InvalidTargetScoreError);
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
