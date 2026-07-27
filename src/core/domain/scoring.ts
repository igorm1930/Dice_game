import type { DiceRoll } from './dice';

/**
 * Bonus added on top of the pip total when a roll sums to seven.
 */
export const LUCKY_SEVEN_BONUS = 10;

/**
 * Multiplier applied to the pip total when both dice match.
 */
export const DOUBLES_MULTIPLIER = 2;

export const RollOutcome = {
  /** Double ones. The one roll that scores nothing. */
  SNAKE_EYES: 'SNAKE_EYES',
  /** Both dice match (excluding snake eyes). */
  DOUBLES: 'DOUBLES',
  /** Pips total exactly seven. */
  LUCKY_SEVEN: 'LUCKY_SEVEN',
  /** No special rule applies; score is the pip total. */
  STANDARD: 'STANDARD',
} as const;

export type RollOutcome = (typeof RollOutcome)[keyof typeof RollOutcome];

export interface RollScore {
  readonly pips: number;
  readonly outcome: RollOutcome;
  readonly points: number;
}

/**
 * The complete scoring rulebook — a pure function of the dice.
 *
 * Rules are evaluated in strict precedence order:
 *   1. SNAKE_EYES  (1,1) ....... 0 points, overrides the doubles bonus
 *   2. DOUBLES     (n,n) ....... pips x 2
 *   3. LUCKY_SEVEN (pips = 7) .. pips + 10
 *   4. STANDARD ................ pips
 *
 * Keeping this pure and dependency-free means the game's entire business value
 * is verifiable by exhaustively enumerating all 36 possible rolls.
 */
export function scoreRoll(dice: DiceRoll): RollScore {
  const pips = dice.first + dice.second;

  if (dice.first === 1 && dice.second === 1) {
    return { pips, outcome: RollOutcome.SNAKE_EYES, points: 0 };
  }

  if (dice.first === dice.second) {
    return { pips, outcome: RollOutcome.DOUBLES, points: pips * DOUBLES_MULTIPLIER };
  }

  if (pips === 7) {
    return { pips, outcome: RollOutcome.LUCKY_SEVEN, points: pips + LUCKY_SEVEN_BONUS };
  }

  return { pips, outcome: RollOutcome.STANDARD, points: pips };
}
