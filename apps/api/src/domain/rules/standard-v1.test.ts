import { describe, expect, it } from 'vitest';

import { type DicePair, type DieValue } from '../dice';
import { applyHold, applyRoll, createGame, type GameState } from '../game';
import {
  STANDARD_RULES_ID,
  STANDARD_RULES_VERSION,
  STANDARD_RULESET_REF,
  standardRulesV1,
} from './standard-v1';

/**
 * Rules tests. These assert what a *throw means*, and nothing about what the
 * engine then does with it — "6 and 6 produces LOSE_ROUND_AND_PASS" lives here,
 * "LOSE_ROUND_AND_PASS clears the round score and switches player" lives in
 * `game.test.ts`. Conflating them means changing a rule breaks engine tests for
 * no reason.
 */

const FACES: readonly DieValue[] = [1, 2, 3, 4, 5, 6];

/**
 * A hand-built state literal rather than one produced by `createGame`: a rules
 * test must not depend on the engine it is meant to be independent of.
 */
function stateWith(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game-1',
    players: [
      { userId: 'user-alice', displayName: 'alice', globalScore: 0, winCount: 0 },
      { userId: 'user-bob', displayName: 'bob', globalScore: 0, winCount: 0 },
    ],
    activePlayer: 0,
    roundScore: 0,
    lastDice: null,
    winningScore: 100,
    ruleset: STANDARD_RULESET_REF,
    gameNumber: 1,
    status: 'ACTIVE',
    winner: null,
    revision: 0,
    effect: null,
    ...overrides,
  };
}

describe('standard@1 identity', () => {
  it('names itself, and the ref matches', () => {
    expect(standardRulesV1.id).toBe(STANDARD_RULES_ID);
    expect(standardRulesV1.version).toBe(STANDARD_RULES_VERSION);
    expect(STANDARD_RULESET_REF).toEqual({ id: 'standard', version: 1 });
  });

  it('publishes the default and the playable bounds', () => {
    expect(standardRulesV1.defaultWinningScore).toBe(100);
    expect(standardRulesV1.minimumWinningScore).toBe(10);
    expect(standardRulesV1.maximumWinningScore).toBe(1000);
  });
});

describe('standard@1 evaluateRoll', () => {
  it('6 and 6 produces LOSE_ROUND_AND_PASS', () => {
    expect(standardRulesV1.evaluateRoll([6, 6])).toEqual({
      type: 'LOSE_ROUND_AND_PASS',
      effect: 'DOUBLE_SIX',
    });
  });

  it('names the effect itself, so the engine never has to know what a bust is', () => {
    // The engine publishes `outcome.effect` verbatim. Naming it here is what
    // keeps a change to BUST_FACE inside this file: a ruleset that lost the
    // round on 5 and 5 would say so, and nothing downstream would need editing.
    expect(standardRulesV1.evaluateRoll([6, 6]).effect).toBe('DOUBLE_SIX');
    expect(standardRulesV1.evaluateRoll([4, 3]).effect).toBe('NORMAL_ROLL');
  });

  it('every other pair produces ADD_TO_ROUND with the sum of both dice', () => {
    for (const first of FACES) {
      for (const second of FACES) {
        if (first === 6 && second === 6) {
          continue;
        }

        const dice: DicePair = [first, second];

        // Only the classification. Asserting `points: first + second` here
        // would mirror the implementation's own expression rather than check
        // it; the literal-valued cases below own the arithmetic.
        expect(standardRulesV1.evaluateRoll(dice).type, `${first} & ${second}`).toBe(
          'ADD_TO_ROUND',
        );
      }
    }
  });

  it('treats a single six as an ordinary six, in either position', () => {
    expect(standardRulesV1.evaluateRoll([6, 1])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 7,
      effect: 'NORMAL_ROLL',
    });
    expect(standardRulesV1.evaluateRoll([3, 6])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 9,
      effect: 'NORMAL_ROLL',
    });
    expect(standardRulesV1.evaluateRoll([6, 5])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 11,
      effect: 'NORMAL_ROLL',
    });
    expect(standardRulesV1.evaluateRoll([5, 6])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 11,
      effect: 'NORMAL_ROLL',
    });
  });

  it('is not fooled by another matching pair', () => {
    expect(standardRulesV1.evaluateRoll([5, 5])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 10,
      effect: 'NORMAL_ROLL',
    });
    expect(standardRulesV1.evaluateRoll([1, 1])).toEqual({
      type: 'ADD_TO_ROUND',
      points: 2,
      effect: 'NORMAL_ROLL',
    });
  });

  it('is pure — the same dice always score the same', () => {
    const expected = { type: 'ADD_TO_ROUND', points: 7, effect: 'NORMAL_ROLL' };

    expect(standardRulesV1.evaluateRoll([4, 3])).toEqual(expected);
    expect(standardRulesV1.evaluateRoll([4, 3])).toEqual(expected);
  });
});

describe('standard@1 hasWon', () => {
  it('wins on exactly the winning score', () => {
    expect(standardRulesV1.hasWon(100, 100)).toBe(true);
  });

  it('does not win one under it', () => {
    expect(standardRulesV1.hasWon(99, 100)).toBe(false);
  });

  it('wins on overshooting it', () => {
    expect(standardRulesV1.hasWon(112, 100)).toBe(true);
  });

  it('honours a custom winning score', () => {
    expect(standardRulesV1.hasWon(9, 10)).toBe(false);
    expect(standardRulesV1.hasWon(10, 10)).toBe(true);
    expect(standardRulesV1.hasWon(2, 2)).toBe(true);
  });
});

describe('standard@1 canHold', () => {
  it('allows a hold on a zero round score — banking zero is how a player passes', () => {
    expect(standardRulesV1.canHold(stateWith({ roundScore: 0 }))).toBe(true);
  });

  it('allows a hold with points on the table', () => {
    expect(standardRulesV1.canHold(stateWith({ roundScore: 17 }))).toBe(true);
  });

  it('refuses once the game is decided', () => {
    expect(standardRulesV1.canHold(stateWith({ status: 'COMPLETED', winner: 0 }))).toBe(false);
  });
});

/**
 * The one place engine and rules are tested together on purpose.
 *
 * Everything else in the engine suite reaches a bust or a banked total through
 * a stand-in ruleset, so changing which combination loses cannot break it.
 * These assert the end-to-end behaviour a player actually experiences under
 * `standard@1` — and they are expected to fail if `BUST_FACE` changes, which is
 * why they live here, alongside the rule they depend on, rather than in
 * `game.test.ts`.
 */
describe('standard@1 end to end', () => {
  const ALICE = { userId: 'user-alice', displayName: 'alice' };
  const BOB = { userId: 'user-bob', displayName: 'bob' };

  function play(throws: readonly DicePair[]): GameState {
    return throws.reduce<GameState>(
      (state, dice) =>
        applyRoll(state, state.players[state.activePlayer].userId, dice, standardRulesV1),
      createGame({ id: 'game-0001', players: [ALICE, BOB] }),
    );
  }

  it('accumulates ordinary throws and then loses it all to a double six', () => {
    expect(
      play([
        [5, 5],
        [4, 4],
        [6, 6],
      ]),
    ).toMatchObject({
      roundScore: 0,
      activePlayer: 1,
      lastDice: [6, 6],
      effect: 'DOUBLE_SIX',
      players: [{ globalScore: 0 }, { globalScore: 0 }],
    });
  });

  it('banks the sum of both dice across a turn, a single six included', () => {
    const held = applyHold(
      play([
        [6, 1],
        [4, 3],
      ]),
      ALICE.userId,
      standardRulesV1,
    );

    expect(held.players[0].globalScore).toBe(14);
    expect(held.activePlayer).toBe(1);
    expect(held.effect).toBe('HELD');
  });
});
