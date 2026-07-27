import { randomInt } from 'node:crypto';

import type { RandomGenerator } from '../../core/ports/random-generator.port';

/**
 * CSPRNG-backed randomness.
 *
 * `crypto.randomInt` is used rather than the far more common
 * `Math.floor(Math.random() * n)` for two reasons: the naive form introduces
 * modulo bias, and `Math.random()` is a predictable PRNG. Neither matters for a
 * toy — both matter the moment a dice roll has money attached to it, and the
 * cost of being correct here is zero.
 */
export class CryptoRandomGenerator implements RandomGenerator {
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new TypeError('RandomGenerator bounds must be integers.');
    }
    if (min > max) {
      throw new RangeError(`Invalid range: min (${min}) must not exceed max (${max}).`);
    }

    // randomInt's upper bound is exclusive; the port's contract is inclusive.
    return randomInt(min, max + 1);
  }
}
