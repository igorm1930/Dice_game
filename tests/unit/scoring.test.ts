import type { DieValue } from '../../src/core/domain/dice';
import {
  DOUBLES_MULTIPLIER,
  LUCKY_SEVEN_BONUS,
  RollOutcome,
  scoreRoll,
} from '../../src/core/domain/scoring';

/**
 * The scoring rules are the entire business value of this service, and they are
 * a pure function over a 36-element input space. So the suite enumerates all of
 * it rather than sampling — there is no reason to leave any of it unverified.
 */
describe('scoreRoll', () => {
  const faces: DieValue[] = [1, 2, 3, 4, 5, 6];

  describe('rule precedence', () => {
    it('scores snake eyes as zero, overriding the doubles bonus', () => {
      const result = scoreRoll({ first: 1, second: 1 });

      expect(result).toEqual({ pips: 2, outcome: RollOutcome.SNAKE_EYES, points: 0 });
    });

    it('doubles the pip total for matching dice', () => {
      const result = scoreRoll({ first: 4, second: 4 });

      expect(result).toEqual({ pips: 8, outcome: RollOutcome.DOUBLES, points: 16 });
    });

    it('adds the lucky-seven bonus when the pips total seven', () => {
      const result = scoreRoll({ first: 3, second: 4 });

      expect(result).toEqual({
        pips: 7,
        outcome: RollOutcome.LUCKY_SEVEN,
        points: 7 + LUCKY_SEVEN_BONUS,
      });
    });

    it('scores the raw pip total when no special rule applies', () => {
      const result = scoreRoll({ first: 2, second: 3 });

      expect(result).toEqual({ pips: 5, outcome: RollOutcome.STANDARD, points: 5 });
    });
  });

  describe('exhaustive enumeration of all 36 rolls', () => {
    const allRolls = faces.flatMap((first) => faces.map((second) => ({ first, second })));

    it.each(allRolls)('classifies ($first, $second) correctly', ({ first, second }) => {
      const result = scoreRoll({ first, second });
      const pips = first + second;

      expect(result.pips).toBe(pips);

      if (first === 1 && second === 1) {
        expect(result.outcome).toBe(RollOutcome.SNAKE_EYES);
        expect(result.points).toBe(0);
      } else if (first === second) {
        expect(result.outcome).toBe(RollOutcome.DOUBLES);
        expect(result.points).toBe(pips * DOUBLES_MULTIPLIER);
      } else if (pips === 7) {
        expect(result.outcome).toBe(RollOutcome.LUCKY_SEVEN);
        expect(result.points).toBe(pips + LUCKY_SEVEN_BONUS);
      } else {
        expect(result.outcome).toBe(RollOutcome.STANDARD);
        expect(result.points).toBe(pips);
      }
    });

    it('never produces a negative score', () => {
      for (const roll of allRolls) {
        expect(scoreRoll(roll).points).toBeGreaterThanOrEqual(0);
      }
    });

    it('awards the maximum score for double sixes', () => {
      const best = allRolls
        .map((roll) => scoreRoll(roll).points)
        .reduce((max, points) => Math.max(max, points), 0);

      expect(best).toBe(24);
      expect(scoreRoll({ first: 6, second: 6 }).points).toBe(24);
    });

    it('is symmetric — die order never changes the score', () => {
      for (const { first, second } of allRolls) {
        expect(scoreRoll({ first, second })).toEqual(scoreRoll({ first: second, second: first }));
      }
    });
  });
});
