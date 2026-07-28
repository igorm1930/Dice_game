import { describe, expect, it } from 'vitest';

import { ERROR_CODES, ERROR_STATUS, REFETCH_ON } from './errors.js';
import { DEFAULT_WINNING_SCORE, MAX_WINNING_SCORE, MIN_WINNING_SCORE } from './primitives.js';
import { PUBLIC_ROUTES, ROUTES } from './routes.js';
import {
  createGameRequestSchema,
  holdRequestSchema,
  newGameRequestSchema,
  rollRequestSchema,
} from './commands.js';
import { gameViewSchema } from './game.js';

/**
 * These assert the contract is internally coherent — the kind of drift that
 * only shows up at runtime, months later, in the one code path nobody exercised.
 */
describe('error taxonomy', () => {
  it('maps every code to exactly one status', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code], `${code} has no status`).toBeTypeOf('number');
    }
    expect(Object.keys(ERROR_STATUS)).toHaveLength(ERROR_CODES.length);
  });

  it('uses only statuses the client knows how to render', () => {
    const allowed = new Set([400, 401, 403, 404, 409, 413, 422, 429, 500]);
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      expect(allowed.has(status), `${code} maps to unexpected ${String(status)}`).toBe(true);
    }
  });

  it('only asks the client to refetch on codes that mean "your view is stale"', () => {
    for (const code of REFETCH_ON) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_STATUS[code]).toBe(code === 'GAME_REVISION_CONFLICT' ? 409 : ERROR_STATUS[code]);
    }
  });
});

describe('winning score bounds', () => {
  it('places the default inside the playable range', () => {
    expect(DEFAULT_WINNING_SCORE).toBeGreaterThanOrEqual(MIN_WINNING_SCORE);
    expect(DEFAULT_WINNING_SCORE).toBeLessThanOrEqual(MAX_WINNING_SCORE);
  });

  it('keeps the minimum low enough to win in one hold, so e2e stays fast', () => {
    expect(MIN_WINNING_SCORE).toBeLessThanOrEqual(12);
  });
});

describe('write commands', () => {
  it('require expectedRevision on every state-changing action', () => {
    expect(rollRequestSchema.safeParse({}).success).toBe(false);
    expect(holdRequestSchema.safeParse({}).success).toBe(false);
    expect(newGameRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a well-formed action', () => {
    expect(rollRequestSchema.safeParse({ expectedRevision: 0 }).success).toBe(true);
    expect(newGameRequestSchema.safeParse({ expectedRevision: 3, winningScore: 50 }).success).toBe(
      true,
    );
  });

  it('rejects any attempt to smuggle an actor, a die, or a score', () => {
    const smuggled = [
      { expectedRevision: 1, userId: '507f1f77bcf86cd799439011' },
      { expectedRevision: 1, dice: [6, 6] },
      { expectedRevision: 1, roundScore: 999 },
      { expectedRevision: 1, activePlayer: 1 },
    ];

    for (const body of smuggled) {
      expect(rollRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('rejects an out-of-range winning score at the edge', () => {
    expect(
      createGameRequestSchema.safeParse({
        opponentId: '507f1f77bcf86cd799439011',
        winningScore: MAX_WINNING_SCORE + 1,
      }).success,
    ).toBe(false);

    expect(
      createGameRequestSchema.safeParse({
        opponentId: '507f1f77bcf86cd799439011',
        winningScore: MIN_WINNING_SCORE - 1,
      }).success,
    ).toBe(false);
  });
});

describe('game view', () => {
  const validGame = {
    id: '507f1f77bcf86cd799439011',
    players: [
      { userId: '507f1f77bcf86cd799439011', displayName: 'Ada', globalScore: 40, winCount: 2 },
      { userId: '507f1f77bcf86cd799439012', displayName: 'Grace', globalScore: 35, winCount: 1 },
    ],
    activePlayer: 0,
    roundScore: 12,
    lastDice: [6, 6],
    winningScore: 100,
    ruleset: { id: 'standard', version: 1 },
    gameNumber: 4,
    status: 'ACTIVE',
    winner: null,
    revision: 17,
    availableActions: { canRoll: true, canHold: true, canStartNewGame: true },
    effect: 'DOUBLE_SIX',
    viewerSeat: 0,
    createdAt: '2026-07-28T10:00:00.000Z',
    updatedAt: '2026-07-28T10:05:00.000Z',
  };

  it('accepts an authoritative view', () => {
    expect(gameViewSchema.safeParse(validGame).success).toBe(true);
  });

  it('requires the client be told what it may do, rather than deriving it', () => {
    const { availableActions: _omitted, ...withoutActions } = validGame;
    expect(gameViewSchema.safeParse(withoutActions).success).toBe(false);
  });

  it('requires exactly two seats', () => {
    expect(
      gameViewSchema.safeParse({ ...validGame, players: [validGame.players[0]] }).success,
    ).toBe(false);
  });

  it('rejects an impossible die face', () => {
    expect(gameViewSchema.safeParse({ ...validGame, lastDice: [7, 1] }).success).toBe(false);
  });
});

describe('routes', () => {
  it('exposes only register, login and the health probes without a token', () => {
    expect([...PUBLIC_ROUTES].sort()).toEqual(
      [ROUTES.auth.register, ROUTES.auth.login, ROUTES.health.live, ROUTES.health.ready].sort(),
    );
  });

  it('addresses every game action by id', () => {
    const id = '507f1f77bcf86cd799439011';
    for (const path of [
      ROUTES.games.byId(id),
      ROUTES.games.roll(id),
      ROUTES.games.hold(id),
      ROUTES.games.newGame(id),
    ]) {
      expect(path).toContain(id);
    }
  });
});
