import type { RandomGenerator } from '../ports/random-generator.port';

export const DIE_MIN_VALUE = 1;
export const DIE_MAX_VALUE = 6;
export const DICE_PER_ROLL = 2;

/**
 * A single die face. Modelled as a literal union so an impossible value such as
 * `7` is a compile error rather than a runtime surprise.
 */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface DiceRoll {
  readonly first: DieValue;
  readonly second: DieValue;
}

export function isDieValue(value: number): value is DieValue {
  return Number.isInteger(value) && value >= DIE_MIN_VALUE && value <= DIE_MAX_VALUE;
}

/**
 * Rolls the pair of dice using an injected source of randomness.
 *
 * Randomness is a dependency, not an ambient capability. Injecting it is what
 * makes every downstream rule deterministic under test.
 */
export function rollDice(random: RandomGenerator): DiceRoll {
  return {
    first: nextDieValue(random),
    second: nextDieValue(random),
  };
}

function nextDieValue(random: RandomGenerator): DieValue {
  const value = random.nextInt(DIE_MIN_VALUE, DIE_MAX_VALUE);

  /* istanbul ignore next -- guards against a misbehaving adapter, not reachable via the shipped one */
  if (!isDieValue(value)) {
    throw new Error(
      `RandomGenerator produced an out-of-range die value: ${String(value)}. ` +
        `Expected an integer in [${DIE_MIN_VALUE}, ${DIE_MAX_VALUE}].`,
    );
  }

  return value;
}
