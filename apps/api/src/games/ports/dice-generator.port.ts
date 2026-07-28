import { type DicePair } from '../../domain/dice';

/**
 * The source of randomness for a Roll.
 *
 * Randomness is a capability, not an ambient fact. `Math.random` is banned
 * inside `src/domain/**` by the linter precisely so that this port has to
 * exist: production throws with `node:crypto`, tests and Playwright throw a
 * scripted sequence, and the domain is handed a pair it cannot influence.
 *
 * Synchronous on purpose. `randomInt` without a callback is synchronous, and a
 * `Promise<DicePair>` would put an await between the turn check and the
 * transition for no benefit whatsoever.
 */
export interface DiceGenerator {
  /** Two faces, always. Never fewer, never more — see `DICE_PER_ROLL`. */
  rollPair(): DicePair;
}

/**
 * DI token for {@link DiceGenerator}.
 *
 * The binding is made in exactly one place — `adapters/dice-generator.provider`
 * — and the deterministic implementation is unreachable outside `NODE_ENV=test`.
 */
export const DICE_GENERATOR = 'DICE_GENERATOR';
