import { dicePairSchema } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { DICE_PER_ROLL, DIE_MAX_VALUE, DIE_MIN_VALUE } from '../../domain/dice';
import { CryptoDiceGenerator } from './crypto-dice.generator';

/**
 * A random source cannot be asserted exactly, so these assert the properties
 * that would actually bite: an out-of-range face reaches the client as a value
 * the contract rejects, and a face that never appears is a die that is quietly
 * five-sided.
 */

const SAMPLE_SIZE = 3000;

describe('CryptoDiceGenerator', () => {
  const generator = new CryptoDiceGenerator();

  it('throws exactly two dice', () => {
    expect(generator.rollPair()).toHaveLength(DICE_PER_ROLL);
  });

  it('never produces a face the contract would reject', () => {
    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      expect(dicePairSchema.safeParse(generator.rollPair())).toMatchObject({ success: true });
    }
  });

  it('can produce every face on both dice', () => {
    const seen: readonly [Set<number>, Set<number>] = [new Set(), new Set()];

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      const pair = generator.rollPair();
      seen[0].add(pair[0]);
      seen[1].add(pair[1]);
    }

    const faces = Array.from(
      { length: DIE_MAX_VALUE - DIE_MIN_VALUE + 1 },
      (_unused, index) => DIE_MIN_VALUE + index,
    );

    expect([...seen[0]].sort()).toEqual(faces);
    expect([...seen[1]].sort()).toEqual(faces);
  });

  it('spreads faces roughly evenly, so no face is structurally favoured', () => {
    const counts = new Map<number, number>();

    for (let i = 0; i < SAMPLE_SIZE; i += 1) {
      for (const face of generator.rollPair()) {
        counts.set(face, (counts.get(face) ?? 0) + 1);
      }
    }

    // A deliberately loose band. This is a smoke test for an off-by-one in the
    // bounds — `randomInt(1, 6)` never returning a six, say — not a statistical
    // test of the CSPRNG, which is not this repository's job to prove.
    const expected = (SAMPLE_SIZE * DICE_PER_ROLL) / (DIE_MAX_VALUE - DIE_MIN_VALUE + 1);

    for (const [, count] of counts) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });
});
