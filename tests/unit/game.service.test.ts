import { GameAlreadyCompletedError, GameNotFoundError } from '../../src/core/domain/errors';
import { GameStatus } from '../../src/core/domain/game';
import { RollOutcome } from '../../src/core/domain/scoring';
import { GameService } from '../../src/core/services/game.service';
import { AsyncMutex } from '../../src/infrastructure/concurrency/async-mutex';
import { InMemoryGameRepository } from '../../src/infrastructure/persistence/in-memory-game.repository';
import { FixedClock, ScriptedRandomGenerator, SequentialIdGenerator } from '../support/fakes';

interface Harness {
  service: GameService;
  repository: InMemoryGameRepository;
  clock: FixedClock;
}

function buildService(sequence: readonly number[] = [3, 4]): Harness {
  const repository = new InMemoryGameRepository();
  const clock = new FixedClock();

  const service = new GameService({
    repository,
    random: new ScriptedRandomGenerator(sequence),
    clock,
    idGenerator: new SequentialIdGenerator(),
    lock: new AsyncMutex(),
    config: { defaultRounds: 5, maxRounds: 20 },
  });

  return { service, repository, clock };
}

describe('GameService', () => {
  describe('createGame', () => {
    it('applies the configured default round count', async () => {
      const { service } = buildService();

      const game = await service.createGame({ playerName: 'Ada' });

      expect(game.totalRounds).toBe(5);
      expect(game.status).toBe(GameStatus.IN_PROGRESS);
      expect(game.playerName).toBe('Ada');
    });

    it('honours an explicit round count', async () => {
      const { service } = buildService();

      const game = await service.createGame({ playerName: 'Ada', rounds: 3 });

      expect(game.totalRounds).toBe(3);
    });

    it('rejects a round count above the configured maximum', async () => {
      const { service } = buildService();

      await expect(service.createGame({ playerName: 'Ada', rounds: 21 })).rejects.toThrow(
        /must be between 1 and 20/,
      );
    });

    it('persists the game so it is immediately readable', async () => {
      const { service, repository } = buildService();

      const created = await service.createGame({ playerName: 'Ada' });

      await expect(repository.findById(created.id)).resolves.toMatchObject({ id: created.id });
    });
  });

  describe('getGame', () => {
    it('throws a domain error for an unknown id', async () => {
      const { service } = buildService();

      await expect(service.getGame('nope')).rejects.toThrow(GameNotFoundError);
    });
  });

  describe('rollDice', () => {
    it('scores the roll and advances the version', async () => {
      // Scripted: 3 then 4 -> lucky seven -> 7 + 10 = 17.
      const { service } = buildService([3, 4]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 2 });

      const { game, round } = await service.rollDice(created.id);

      expect(round).toMatchObject({
        index: 1,
        pips: 7,
        outcome: RollOutcome.LUCKY_SEVEN,
        points: 17,
        scoreAfter: 17,
      });
      expect(game.totalScore).toBe(17);
      expect(game.version).toBe(1);
      expect(game.status).toBe(GameStatus.IN_PROGRESS);
    });

    it('completes the game on the final round', async () => {
      const { service } = buildService([2, 2]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 1 });

      const { game } = await service.rollDice(created.id);

      expect(game.status).toBe(GameStatus.COMPLETED);
      expect(game.completedAt).not.toBeNull();
      expect(game.totalScore).toBe(8); // doubles: 4 pips x 2
    });

    it('refuses to roll a completed game', async () => {
      const { service } = buildService([2, 2]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 1 });
      await service.rollDice(created.id);

      await expect(service.rollDice(created.id)).rejects.toThrow(GameAlreadyCompletedError);
    });

    it('throws for an unknown game', async () => {
      const { service } = buildService();

      await expect(service.rollDice('00000000-0000-4000-8000-999999999999')).rejects.toThrow(
        GameNotFoundError,
      );
    });

    it('stamps the round with the injected clock', async () => {
      const { service, clock } = buildService([1, 2]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 2 });
      clock.advance(60_000);

      const { round } = await service.rollDice(created.id);

      expect(round.rolledAt).toBe('2026-01-01T00:01:00.000Z');
    });

    /**
     * The regression test for the lost-update hazard.
     *
     * Without the keyed lock, both rolls read version 0, both compute round 1,
     * and one of them is silently discarded — the game would report a single
     * round played after two successful requests.
     */
    it('serialises concurrent rolls on the same game without losing any', async () => {
      const { service } = buildService([1, 2]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 5 });

      const results = await Promise.all([
        service.rollDice(created.id),
        service.rollDice(created.id),
        service.rollDice(created.id),
      ]);

      expect(results.map((r) => r.round.index).sort()).toEqual([1, 2, 3]);

      const final = await service.getGame(created.id);
      expect(final.rounds).toHaveLength(3);
      expect(final.version).toBe(3);
      expect(final.totalScore).toBe(9); // 3 pips x 3 rounds, all STANDARD
    });

    it('stops exactly at the round limit under concurrency', async () => {
      const { service } = buildService([1, 2]);
      const created = await service.createGame({ playerName: 'Ada', rounds: 2 });

      const outcomes = await Promise.allSettled([
        service.rollDice(created.id),
        service.rollDice(created.id),
        service.rollDice(created.id),
      ]);

      expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(2);
      expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);

      const final = await service.getGame(created.id);
      expect(final.rounds).toHaveLength(2);
      expect(final.status).toBe(GameStatus.COMPLETED);
    });

    it('does not serialise rolls belonging to different games', async () => {
      const { service } = buildService([1, 2]);
      const first = await service.createGame({ playerName: 'Ada', rounds: 1 });
      const second = await service.createGame({ playerName: 'Bob', rounds: 1 });

      const [a, b] = await Promise.all([service.rollDice(first.id), service.rollDice(second.id)]);

      expect(a.game.id).toBe(first.id);
      expect(b.game.id).toBe(second.id);
    });
  });

  describe('listGames', () => {
    it('paginates', async () => {
      const { service } = buildService();
      await service.createGame({ playerName: 'A' });
      await service.createGame({ playerName: 'B' });

      const page = await service.listGames({ limit: 1, offset: 0 });

      expect(page.items).toHaveLength(1);
      expect(page.total).toBe(2);
    });
  });

  describe('getLeaderboard', () => {
    it('ranks completed games by score', async () => {
      const { service } = buildService([6, 6]);
      const winner = await service.createGame({ playerName: 'Winner', rounds: 1 });
      await service.rollDice(winner.id);
      await service.createGame({ playerName: 'Unfinished', rounds: 5 });

      const board = await service.getLeaderboard(10);

      expect(board).toHaveLength(1);
      expect(board[0]).toMatchObject({ playerName: 'Winner', totalScore: 24 });
    });
  });
});
