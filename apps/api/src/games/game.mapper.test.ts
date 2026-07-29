import { gameViewSchema } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { UnsupportedRulesetError } from '../domain/errors';
import { applyHold, applyRoll, createGame, type GameState } from '../domain/game';
import { type GameRules, type RollOutcome } from '../domain/rules/game-rules';
import { standardRulesV1 } from '../domain/rules/standard-v1';
import { toGameView } from './game.mapper';
import { type PersistedGame } from './ports/game-repository.port';

/**
 * The mapper's job is to be *total* and *viewer-relative*: every field the
 * contract declares, filled in from the aggregate, with `availableActions` and
 * `viewerSeat` answered for whoever asked.
 *
 * The strongest assertion available is that real output parses through
 * `gameViewSchema` — the same schema the client builds its types from — so most
 * of these end there rather than in a hand-written expectation.
 *
 * Ids are 24-character hex because `idSchema` says so. A fixture using
 * `'user-alice'` would produce output the contract rejects, and the failure
 * would look like a mapper bug rather than a fixture one.
 */

const GAME_ID = '507f1f77bcf86cd799439011';
const ADA = { userId: '507f1f77bcf86cd799439012', displayName: 'Ada' };
const GRACE = { userId: '507f1f77bcf86cd799439013', displayName: 'Grace' };
const SPECTATOR_ID = '507f1f77bcf86cd799439014';

const CREATED_AT = new Date('2026-07-28T10:00:00.000Z');
const UPDATED_AT = new Date('2026-07-28T10:05:00.000Z');

/**
 * A stand-in ruleset, hand-written — this suite uses no mocking framework, and
 * naming a losing combination in a mapper fixture would silently assert a rule
 * that belongs to `rules/standard-v1.test.ts`.
 */
function rulesProducing(outcome: RollOutcome): GameRules {
  return {
    ...standardRulesV1,
    evaluateRoll: () => outcome,
  };
}

function game(winningScore?: number): GameState {
  return createGame({ id: GAME_ID, players: [ADA, GRACE], winningScore });
}

function persisted(
  state: GameState,
  createdAt = CREATED_AT,
  updatedAt = UPDATED_AT,
): PersistedGame {
  return { ...state, createdAt, updatedAt };
}

/** Puts points on the table for the active player, without naming a die face. */
function score(state: GameState, points: number): GameState {
  return applyRoll(
    state,
    state.players[state.activePlayer].userId,
    [2, 3],
    rulesProducing({ type: 'ADD_TO_ROUND', points, effect: 'NORMAL_ROLL' }),
  );
}

/** Loses the round for the active player, without naming a losing combination. */
function bust(state: GameState): GameState {
  return applyRoll(
    state,
    state.players[state.activePlayer].userId,
    [2, 3],
    rulesProducing({ type: 'LOSE_ROUND_AND_PASS', effect: 'DOUBLE_SIX' }),
  );
}

describe('toGameView', () => {
  it('produces a view the contract accepts', () => {
    const view = toGameView(persisted(game()), ADA.userId);

    expect(gameViewSchema.safeParse(view)).toMatchObject({ success: true });
  });

  it('still produces a view the contract accepts mid-match', () => {
    const state = applyHold(score(game(), 12), ADA.userId, standardRulesV1);
    const view = toGameView(persisted(state), GRACE.userId);

    expect(gameViewSchema.safeParse(view)).toMatchObject({ success: true });
  });

  it('carries the board across verbatim', () => {
    const state = score(game(50), 9);

    expect(toGameView(persisted(state), ADA.userId)).toMatchObject({
      id: GAME_ID,
      players: [
        { userId: ADA.userId, displayName: 'Ada', globalScore: 0, winCount: 0 },
        { userId: GRACE.userId, displayName: 'Grace', globalScore: 0, winCount: 0 },
      ],
      activePlayer: 0,
      roundScore: 9,
      winningScore: 50,
      ruleset: { id: 'standard', version: 1 },
      gameNumber: 1,
      status: 'ACTIVE',
      winner: null,
      revision: 0,
      effect: 'NORMAL_ROLL',
    });
  });

  it('serialises timestamps as ISO-8601 UTC', () => {
    const view = toGameView(persisted(game()), ADA.userId);

    expect(view.createdAt).toBe('2026-07-28T10:00:00.000Z');
    expect(view.updatedAt).toBe('2026-07-28T10:05:00.000Z');
  });

  it('reports no dice before the first roll of a game', () => {
    expect(toGameView(persisted(game()), ADA.userId).lastDice).toBeNull();
  });

  it('reports the faces that were last thrown', () => {
    const view = toGameView(persisted(score(game(), 5)), ADA.userId);

    expect(view.lastDice).toEqual([2, 3]);
  });

  it('hands out a copy of the dice rather than a reference into the store', () => {
    const stored = persisted(score(game(), 5));
    const view = toGameView(stored, ADA.userId);

    expect(view.lastDice).not.toBe(stored.lastDice);
  });

  it('publishes the effect the ruleset named for the last action', () => {
    expect(toGameView(persisted(bust(game())), ADA.userId).effect).toBe('DOUBLE_SIX');
    expect(toGameView(persisted(game()), ADA.userId).effect).toBeNull();
  });
});

describe('viewerSeat', () => {
  it('is the chair the requesting user occupies', () => {
    const stored = persisted(game());

    expect(toGameView(stored, ADA.userId).viewerSeat).toBe(0);
    expect(toGameView(stored, GRACE.userId).viewerSeat).toBe(1);
  });

  it('is null for somebody who is only watching', () => {
    expect(toGameView(persisted(game()), SPECTATOR_ID).viewerSeat).toBeNull();
  });
});

describe('availableActions', () => {
  it('offers the active player both moves', () => {
    expect(toGameView(persisted(game()), ADA.userId).availableActions).toEqual({
      canRoll: true,
      canHold: true,
      canStartNewGame: true,
    });
  });

  it('offers the waiting player only a restart', () => {
    expect(toGameView(persisted(game()), GRACE.userId).availableActions).toEqual({
      canRoll: false,
      canHold: false,
      canStartNewGame: true,
    });
  });

  it('offers a spectator nothing at all, telling them nothing about whose turn it is', () => {
    expect(toGameView(persisted(game()), SPECTATOR_ID).availableActions).toEqual({
      canRoll: false,
      canHold: false,
      canStartNewGame: false,
    });
  });

  it('withdraws both moves once the game is won, for the winner as well', () => {
    const won = applyHold(score(game(10), 12), ADA.userId, standardRulesV1);
    const view = toGameView(persisted(won), ADA.userId);

    expect(view).toMatchObject({ status: 'COMPLETED', winner: 0, effect: 'GAME_WON' });
    expect(view.availableActions).toEqual({
      canRoll: false,
      canHold: false,
      canStartNewGame: true,
    });
  });

  it('is decided by the domain, not recomputed here', () => {
    // The same state, read by the two seats, must disagree in exactly the way
    // `availableActionsFor` does — this is the assertion that would fail if the
    // mapper ever started deriving legality of its own.
    const state = score(game(), 4);

    expect(toGameView(persisted(state), ADA.userId).availableActions.canRoll).toBe(true);
    expect(toGameView(persisted(state), GRACE.userId).availableActions.canRoll).toBe(false);
  });
});

describe('ruleset', () => {
  it('refuses to render a game recorded under rules the contract cannot express', () => {
    const stored: PersistedGame = {
      ...persisted(game()),
      ruleset: { id: 'chaos', version: 9 },
    };

    expect(() => toGameView(stored, ADA.userId)).toThrow(UnsupportedRulesetError);
  });
});
