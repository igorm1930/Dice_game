import { dicePairSchema } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { type DicePair } from '../../domain/dice';
import { DEFAULT_DICE_SEQUENCE, DeterministicDiceGenerator } from './deterministic-dice.generator';

describe('DeterministicDiceGenerator', () => {
  it('throws the script in order', () => {
    const generator = new DeterministicDiceGenerator([
      [1, 2],
      [3, 4],
    ]);

    expect(generator.rollPair()).toEqual([1, 2]);
    expect(generator.rollPair()).toEqual([3, 4]);
  });

  it('cycles rather than running out, so a long scenario cannot break mid-run', () => {
    const generator = new DeterministicDiceGenerator([
      [1, 2],
      [3, 4],
    ]);

    generator.rollPair();
    generator.rollPair();

    expect(generator.rollPair()).toEqual([1, 2]);
  });

  it('counts its throws, so a test can prove none were wasted', () => {
    const generator = new DeterministicDiceGenerator();

    expect(generator.throwCount).toBe(0);

    generator.rollPair();
    generator.rollPair();

    expect(generator.throwCount).toBe(2);
  });

  it('rewinds on reset', () => {
    const generator = new DeterministicDiceGenerator([
      [1, 2],
      [3, 4],
    ]);

    generator.rollPair();
    generator.reset();

    expect(generator.rollPair()).toEqual([1, 2]);
    expect(generator.throwCount).toBe(1);
  });

  it('rewinds when the script is replaced', () => {
    const generator = new DeterministicDiceGenerator([[1, 2]]);

    generator.rollPair();
    generator.setSequence([[5, 5]]);

    expect(generator.rollPair()).toEqual([5, 5]);
  });

  it('refuses an empty script rather than inventing a throw', () => {
    expect(() => new DeterministicDiceGenerator([])).toThrow(/at least one throw/);
  });

  it('refuses a script naming an impossible face', () => {
    const impossible = [[7, 1]] as unknown as readonly DicePair[];

    expect(() => new DeterministicDiceGenerator(impossible)).toThrow(/not a pair of die faces/);
  });

  it('does not let a caller edit the script it handed in', () => {
    const script: DicePair[] = [[1, 2]];
    const generator = new DeterministicDiceGenerator(script);

    script.push([3, 4]);

    expect(generator.rollPair()).toEqual([1, 2]);
    expect(generator.rollPair()).toEqual([1, 2]);
  });

  describe('the default script', () => {
    it('names only faces the contract accepts', () => {
      for (const pair of DEFAULT_DICE_SEQUENCE) {
        expect(dicePairSchema.safeParse(pair)).toMatchObject({ success: true });
      }
    });

    it('opens with a throw that banks enough to win at the minimum winning score', () => {
      const first = DEFAULT_DICE_SEQUENCE[0];

      expect(first).toBeDefined();
      // MIN_WINNING_SCORE is 2 so that an e2e run wins in a single hold.
      expect((first?.[0] ?? 0) + (first?.[1] ?? 0)).toBeGreaterThanOrEqual(2);
    });
  });
});
