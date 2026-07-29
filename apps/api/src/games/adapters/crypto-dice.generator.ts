import { randomInt } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  DIE_MAX_VALUE,
  DIE_MIN_VALUE,
  type DicePair,
  type DieValue,
  isDieValue,
} from '../../domain/dice';
import { type DiceGenerator } from '../ports/dice-generator.port';

/**
 * The production dice.
 *
 * `randomInt` from `node:crypto` rather than `Math.random`, and the choice is
 * not decoration: `Math.random` is seeded per process and its output is
 * predictable from a handful of observations. Dice decide who wins, so they are
 * drawn from the CSPRNG. `randomInt` also rejection-samples internally, so every
 * face is equally likely — `Math.floor(Math.random() * 6)` is uniform, but the
 * modulo form of the same idea is not, and the two are easy to confuse.
 *
 * The upper bound is exclusive, hence `DIE_MAX_VALUE + 1`.
 */
@Injectable()
export class CryptoDiceGenerator implements DiceGenerator {
  rollPair(): DicePair {
    return [this.rollDie(), this.rollDie()];
  }

  /**
   * Narrowed through the domain's own guard rather than asserted with `as`.
   *
   * The throw is unreachable while the bounds above are the domain's, and that
   * is the point: if `DIE_MAX_VALUE` ever changed under this file, the failure
   * would be a loud one here rather than an impossible face rendered on a
   * client.
   */
  private rollDie(): DieValue {
    const face = randomInt(DIE_MIN_VALUE, DIE_MAX_VALUE + 1);

    if (!isDieValue(face)) {
      throw new Error(`Dice generator produced ${String(face)}, which is not a die face.`);
    }

    return face;
  }
}
