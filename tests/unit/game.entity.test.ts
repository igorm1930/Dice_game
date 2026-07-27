import { rollDice } from '../../src/core/domain/dice';
import { GameAlreadyCompletedError, InvalidRoundCountError } from '../../src/core/domain/errors';
import {
  GameStatus,
  createGame,
  playRound,
  remainingRounds,
  type Game,
} from '../../src/core/domain/game';
import { ConstantRandomGenerator, ScriptedRandomGenerator } from '../support/fakes';

const NOW = new Date('2026-01-01T12:00:00.000Z');

function newGame(overrides: Partial<Parameters<typeof createGame>[0]> = {}): Game {
  return createGame({
    id: 'game-1',
    playerName: 'Ada',
    totalRounds: 3,
    maxRounds: 20,
    now: NOW,
    ...overrides,
  });
}

describe('createGame', () => {
  it('starts in progress with a zeroed score and no rounds', () => {
    const game = newGame();

    expect(game).toMatchObject({
      id: 'game-1',
      playerName: 'Ada',
      status: GameStatus.IN_PROGRESS,
      totalRounds: 3,
      totalScore: 0,
      completedAt: null,
      version: 0,
    });
    expect(game.rounds).toHaveLength(0);
    expect(game.createdAt).toBe('2026-01-01T12:00:00.000Z');
  });

  it.each([0, -1, 21, 1.5, Number.NaN])('rejects an invalid round count: %s', (totalRounds) => {
    expect(() => newGame({ totalRounds })).toThrow(InvalidRoundCountError);
  });

  it('accepts the configured boundary values', () => {
    expect(newGame({ totalRounds: 1 }).totalRounds).toBe(1);
    expect(newGame({ totalRounds: 20 }).totalRounds).toBe(20);
  });

  it('carries the offending values on the error for the API to surface', () => {
    expect.assertions(1);

    try {
      newGame({ totalRounds: 99 });
    } catch (error) {
      expect((error as InvalidRoundCountError).details).toEqual({
        requested: 99,
        maxRounds: 20,
      });
    }
  });
});

describe('playRound', () => {
  it('appends a round and accumulates the score', () => {
    const game = newGame();

    const { game: next, round } = playRound(game, { first: 3, second: 4 }, NOW);

    expect(round.index).toBe(1);
    expect(round.points).toBe(17);
    expect(round.scoreAfter).toBe(17);
    expect(next.totalScore).toBe(17);
    expect(next.rounds).toHaveLength(1);
    expect(next.status).toBe(GameStatus.IN_PROGRESS);
  });

  it('does not mutate the previous snapshot', () => {
    const game = newGame();

    playRound(game, { first: 6, second: 6 }, NOW);

    expect(game.rounds).toHaveLength(0);
    expect(game.totalScore).toBe(0);
  });

  it('auto-completes on the final round and stamps completedAt', () => {
    const later = new Date('2026-01-01T12:05:00.000Z');
    let game = newGame({ totalRounds: 2 });

    game = playRound(game, { first: 2, second: 3 }, NOW).game;
    expect(game.status).toBe(GameStatus.IN_PROGRESS);
    expect(game.completedAt).toBeNull();

    game = playRound(game, { first: 5, second: 2 }, later).game;

    expect(game.status).toBe(GameStatus.COMPLETED);
    expect(game.completedAt).toBe('2026-01-01T12:05:00.000Z');
    expect(game.totalScore).toBe(5 + 17);
  });

  it('refuses to roll a completed game', () => {
    let game = newGame({ totalRounds: 1 });
    game = playRound(game, { first: 1, second: 2 }, NOW).game;

    expect(() => playRound(game, { first: 4, second: 4 }, NOW)).toThrow(GameAlreadyCompletedError);
  });

  it('keeps the running total consistent across every round', () => {
    let game = newGame({ totalRounds: 3 });
    const rolls = [
      { first: 1, second: 1 }, // snake eyes -> 0
      { first: 5, second: 5 }, // doubles -> 20
      { first: 1, second: 6 }, // lucky seven -> 17
    ] as const;

    let expected = 0;
    for (const roll of rolls) {
      const result = playRound(game, roll, NOW);
      game = result.game;
      expected += result.round.points;
      expect(result.round.scoreAfter).toBe(expected);
    }

    expect(game.totalScore).toBe(37);
    expect(game.rounds.map((round) => round.index)).toEqual([1, 2, 3]);
  });

  it('leaves the version untouched — versioning belongs to the repository', () => {
    const game = newGame();
    const { game: next } = playRound(game, { first: 2, second: 2 }, NOW);

    expect(next.version).toBe(game.version);
  });
});

describe('remainingRounds', () => {
  it('counts down and floors at zero', () => {
    let game = newGame({ totalRounds: 2 });
    expect(remainingRounds(game)).toBe(2);

    game = playRound(game, { first: 1, second: 2 }, NOW).game;
    expect(remainingRounds(game)).toBe(1);

    game = playRound(game, { first: 1, second: 2 }, NOW).game;
    expect(remainingRounds(game)).toBe(0);
  });
});

describe('rollDice', () => {
  it('draws exactly two values from the generator', () => {
    const random = new ScriptedRandomGenerator([2, 5]);

    expect(rollDice(random)).toEqual({ first: 2, second: 5 });
    expect(random.callCount).toBe(2);
  });

  it('rejects an adapter that returns an out-of-range face', () => {
    expect(() => rollDice(new ConstantRandomGenerator(7))).toThrow(/out-of-range die value/);
  });
});
