import {
  DEFAULT_WINNING_SCORE,
  ERROR_CODES,
  gameEffectSchema,
  gameStatusSchema,
  MAX_WINNING_SCORE,
  MIN_WINNING_SCORE,
  STANDARD_RULESET,
} from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import {
  type DomainError,
  GameOverError,
  HoldNotAvailableError,
  InvalidOpponentError,
  InvalidTargetScoreError,
  NotAParticipantError,
  NotYourTurnError,
  UnsupportedRulesetError,
} from './domain/errors';
import { type GameEffect, type GameStatus } from './domain/game';
import { STANDARD_RULESET_REF, standardRulesV1 } from './domain/rules/standard-v1';

/**
 * The domain may not import `@dice-game/contracts` — the linter blocks it, so
 * that the rules stay framework- and wire-independent. The cost of that
 * boundary is a small amount of deliberate duplication: the winning-score
 * bounds, the effect names and the error codes exist on both sides.
 *
 * This file is the guard on that duplication. It lives *outside* `src/domain`,
 * where importing the contract is allowed, and fails the build the moment the
 * two drift. Phase 3 adds the mapping layer; this asserts the mapping will be
 * total before a line of it is written.
 */

describe('winning-score bounds', () => {
  it('agree with the contract', () => {
    expect(standardRulesV1.defaultWinningScore).toBe(DEFAULT_WINNING_SCORE);
    expect(standardRulesV1.minimumWinningScore).toBe(MIN_WINNING_SCORE);
    expect(standardRulesV1.maximumWinningScore).toBe(MAX_WINNING_SCORE);
  });
});

describe('ruleset ref', () => {
  it('matches the one the contract names', () => {
    expect(STANDARD_RULESET_REF).toEqual(STANDARD_RULESET);
  });
});

describe('domain error codes', () => {
  const errors: readonly DomainError[] = [
    new GameOverError('roll', 0),
    new NotAParticipantError('user-carol'),
    new NotYourTurnError('roll', 1, 0),
    new InvalidTargetScoreError(1, 2, 1000),
    new HoldNotAvailableError(0),
    new InvalidOpponentError('user-alice'),
    new UnsupportedRulesetError({ id: 'standard', version: 2 }),
  ];

  it.each(errors.map((error) => [error.name, error] as const))(
    '%s carries a code the contract knows',
    (_name, error) => {
      expect(ERROR_CODES).toContain(error.code);
    },
  );

  it('never carries an HTTP status', () => {
    for (const error of errors) {
      expect(error).not.toHaveProperty('status');
      expect(error).not.toHaveProperty('statusCode');
      expect(error).not.toHaveProperty('httpStatus');
    }
  });

  it('freezes its details so a handler cannot edit what gets serialised', () => {
    for (const error of errors) {
      expect(Object.isFrozen(error.details)).toBe(true);
    }
  });
});

describe('game effects and statuses', () => {
  /**
   * A `Record` keyed by the domain union: adding an effect to the domain is a
   * compile error until it is listed here, at which point this test fails until
   * the contract agrees.
   */
  const DOMAIN_EFFECTS: Record<GameEffect, true> = {
    NORMAL_ROLL: true,
    DOUBLE_SIX: true,
    HELD: true,
    GAME_WON: true,
    NEW_GAME: true,
  };

  const DOMAIN_STATUSES: Record<GameStatus, true> = {
    ACTIVE: true,
    COMPLETED: true,
  };

  it('name exactly the effects the contract carries', () => {
    expect(Object.keys(DOMAIN_EFFECTS).sort()).toEqual([...gameEffectSchema.options].sort());
  });

  it('name exactly the statuses the contract carries', () => {
    expect(Object.keys(DOMAIN_STATUSES).sort()).toEqual([...gameStatusSchema.options].sort());
  });
});
