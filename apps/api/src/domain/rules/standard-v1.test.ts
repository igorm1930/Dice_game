import { describe, expect, it } from 'vitest';

import { type DicePair, type DieValue } from '../dice';
import { type GameState } from '../game';
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
    expect(standardRulesV1.minimumWinningScore).toBe(2);
    expect(standardRulesV1.maximumWinningScore).toBe(1000);
  });
});

describe('standard@1 evaluateRoll', () => {
  it('6 and 6 produces LOSE_ROUND_AND_PASS', () => {
    expect(standardRulesV1.evaluateRoll([6, 6])).toEqual({ type: 'LOSE_ROUND_AND_PASS' });
  });

  it('every other pair produces ADD_TO_ROUND with the sum of both dice', () => {
    for (const first of FACES) {
      for (const second of FACES) {
        if (first === 6 && second === 6) {
          continue;
        }

        const dice: DicePair = [first, second];

        expect(standardRulesV1.evaluateRoll(dice), `${first} & ${second}`).toEqual({
          type: 'ADD_TO_ROUND',
          points: first + second,
        });
      }
    }
  });

  it('treats a single six as an ordinary six, in either position', () => {
    expect(standardRulesV1.evaluateRoll([6, 1])).toEqual({ type: 'ADD_TO_ROUND', points: 7 });
    expect(standardRulesV1.evaluateRoll([3, 6])).toEqual({ type: 'ADD_TO_ROUND', points: 9 });
    expect(standardRulesV1.evaluateRoll([6, 5])).toEqual({ type: 'ADD_TO_ROUND', points: 11 });
    expect(standardRulesV1.evaluateRoll([5, 6])).toEqual({ type: 'ADD_TO_ROUND', points: 11 });
  });

  it('is not fooled by another matching pair', () => {
    expect(standardRulesV1.evaluateRoll([5, 5])).toEqual({ type: 'ADD_TO_ROUND', points: 10 });
    expect(standardRulesV1.evaluateRoll([1, 1])).toEqual({ type: 'ADD_TO_ROUND', points: 2 });
  });

  it('is pure — the same dice always score the same', () => {
    expect(standardRulesV1.evaluateRoll([4, 3])).toEqual(standardRulesV1.evaluateRoll([4, 3]));
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
