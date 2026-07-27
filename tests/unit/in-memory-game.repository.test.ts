import { ConcurrencyConflictError, GameNotFoundError } from '../../src/core/domain/errors';
import { createGame, playRound, type Game } from '../../src/core/domain/game';
import { InMemoryGameRepository } from '../../src/infrastructure/persistence/in-memory-game.repository';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function makeGame(id: string, playerName = 'Ada', createdAt = NOW): Game {
  return createGame({ id, playerName, totalRounds: 2, maxRounds: 20, now: createdAt });
}

describe('InMemoryGameRepository', () => {
  let repository: InMemoryGameRepository;

  beforeEach(() => {
    repository = new InMemoryGameRepository();
  });

  describe('create / findById', () => {
    it('round-trips an aggregate', async () => {
      const created = await repository.create(makeGame('a'));
      const found = await repository.findById('a');

      expect(found).toEqual(created);
    });

    it('returns null for an unknown id rather than throwing', async () => {
      await expect(repository.findById('missing')).resolves.toBeNull();
    });

    it('rejects a duplicate id', async () => {
      await repository.create(makeGame('a'));

      await expect(repository.create(makeGame('a'))).rejects.toThrow(/already exists/);
    });
  });

  describe('snapshot isolation', () => {
    /**
     * The property that makes an in-memory store a legitimate repository rather
     * than a shared mutable global. A real datastore gives this for free via
     * serialisation; here it must be explicit.
     */
    it('does not expose a live reference to stored state', async () => {
      const created = await repository.create(makeGame('a'));

      const mutated = created as unknown as { totalScore: number };
      mutated.totalScore = 9999;

      const found = await repository.findById('a');
      expect(found?.totalScore).toBe(0);
    });

    it('returns a distinct object on each read', async () => {
      await repository.create(makeGame('a'));

      const first = await repository.findById('a');
      const second = await repository.findById('a');

      expect(first).toEqual(second);
      expect(first).not.toBe(second);
    });
  });

  describe('optimistic concurrency', () => {
    it('increments the version on every write', async () => {
      const created = await repository.create(makeGame('a'));
      expect(created.version).toBe(0);

      const updated = await repository.update(
        playRound(created, { first: 1, second: 2 }, NOW).game,
      );
      expect(updated.version).toBe(1);
    });

    it('rejects a write based on a stale snapshot', async () => {
      const created = await repository.create(makeGame('a'));

      // Two callers read the same version...
      const readerOne = playRound(created, { first: 1, second: 2 }, NOW).game;
      const readerTwo = playRound(created, { first: 3, second: 4 }, NOW).game;

      await repository.update(readerOne);

      // ...the second write must be refused, not silently overwrite the first.
      await expect(repository.update(readerTwo)).rejects.toThrow(ConcurrencyConflictError);
    });

    it('reports both versions on conflict so a client can reason about the retry', async () => {
      expect.assertions(1);
      const created = await repository.create(makeGame('a'));
      const stale = playRound(created, { first: 1, second: 2 }, NOW).game;
      await repository.update(stale);

      try {
        await repository.update(stale);
      } catch (error) {
        expect((error as ConcurrencyConflictError).details).toEqual({
          gameId: 'a',
          expectedVersion: 0,
          actualVersion: 1,
        });
      }
    });

    it('rejects an update to a game that does not exist', async () => {
      await expect(repository.update(makeGame('ghost'))).rejects.toThrow(GameNotFoundError);
    });
  });

  describe('findAll', () => {
    beforeEach(async () => {
      await repository.create(makeGame('a', 'Ada', new Date('2026-01-01T00:00:00.000Z')));
      await repository.create(makeGame('b', 'Bob', new Date('2026-01-02T00:00:00.000Z')));
      await repository.create(makeGame('c', 'Cy', new Date('2026-01-03T00:00:00.000Z')));
    });

    it('returns newest first', async () => {
      const page = await repository.findAll({ limit: 10, offset: 0 });

      expect(page.items.map((game) => game.id)).toEqual(['c', 'b', 'a']);
      expect(page.total).toBe(3);
    });

    it('applies limit and offset', async () => {
      const page = await repository.findAll({ limit: 1, offset: 1 });

      expect(page.items.map((game) => game.id)).toEqual(['b']);
      expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
    });

    it('returns an empty page past the end without error', async () => {
      const page = await repository.findAll({ limit: 10, offset: 99 });

      expect(page.items).toEqual([]);
      expect(page.total).toBe(3);
    });
  });

  describe('findLeaderboard', () => {
    async function completedGame(
      id: string,
      player: string,
      dice: { first: 1 | 6; second: 1 | 6 },
    ): Promise<Game> {
      const created = await repository.create(
        createGame({ id, playerName: player, totalRounds: 1, maxRounds: 20, now: NOW }),
      );
      const played = playRound(created, dice, NOW).game;
      return repository.update(played);
    }

    it('excludes games still in progress', async () => {
      await repository.create(makeGame('in-progress'));
      await completedGame('done', 'Ada', { first: 6, second: 6 });

      const board = await repository.findLeaderboard(10);

      expect(board.map((game) => game.id)).toEqual(['done']);
    });

    it('ranks by descending score', async () => {
      await completedGame('low', 'Lo', { first: 1, second: 1 });
      await completedGame('high', 'Hi', { first: 6, second: 6 });

      const board = await repository.findLeaderboard(10);

      expect(board.map((game) => game.id)).toEqual(['high', 'low']);
      expect(board[0]?.totalScore).toBe(24);
    });

    it('honours the limit', async () => {
      await completedGame('one', 'A', { first: 6, second: 6 });
      await completedGame('two', 'B', { first: 6, second: 6 });

      await expect(repository.findLeaderboard(1)).resolves.toHaveLength(1);
    });

    it('returns an empty board when nothing is finished', async () => {
      await repository.create(makeGame('a'));

      await expect(repository.findLeaderboard(10)).resolves.toEqual([]);
    });

    /**
     * A leaderboard that reorders equal scores between two calls looks broken to
     * a user refreshing the page, so ties resolve deterministically.
     */
    it('breaks ties by earliest completion, stably across calls', async () => {
      const earlier = new Date('2026-01-01T00:00:00.000Z');
      const later = new Date('2026-01-01T00:05:00.000Z');

      for (const [id, when] of [
        ['second', later],
        ['first', earlier],
      ] as const) {
        const created = await repository.create(
          createGame({ id, playerName: id, totalRounds: 1, maxRounds: 20, now: when }),
        );
        await repository.update(playRound(created, { first: 6, second: 6 }, when).game);
      }

      const board = await repository.findLeaderboard(10);

      expect(board.map((game) => game.totalScore)).toEqual([24, 24]);
      expect(board.map((game) => game.id)).toEqual(['first', 'second']);

      const again = await repository.findLeaderboard(10);
      expect(again.map((game) => game.id)).toEqual(board.map((game) => game.id));
    });

    it('orders ids deterministically when games share a creation timestamp', async () => {
      const same = new Date('2026-02-01T00:00:00.000Z');
      await repository.create(makeGame('b', 'B', same));
      await repository.create(makeGame('a', 'A', same));

      const page = await repository.findAll({ limit: 10, offset: 0 });

      expect(page.items.map((game) => game.id)).toEqual(['b', 'a']);
    });
  });
});
