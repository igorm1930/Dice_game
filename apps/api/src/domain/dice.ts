/**
 * The dice, and deliberately nothing that throws them.
 *
 * Randomness is a capability, not an ambient fact: a `DiceGenerator` port lives
 * outside the domain and is injected by the composition root, so production can
 * use `node:crypto` while tests use a scripted sequence. That is why this file
 * defines only the *shape* of a throw. Adding a `roll()` here would put
 * `Math.random` inside the domain and make every downstream rule
 * untestable — the linter blocks it, and this comment explains why.
 */

export const DIE_MIN_VALUE = 1;
export const DIE_MAX_VALUE = 6;

/** Two dice are thrown on every Roll, always. */
export const DICE_PER_ROLL = 2;

/**
 * A single die face.
 *
 * Modelled as a literal union so an impossible value such as `7` is a compile
 * error rather than a runtime surprise.
 */
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * The pair thrown on every Roll.
 *
 * A positional tuple rather than a `{ first, second }` record: the two faces are
 * symmetric under these rules — only "both sixes" is special — so naming them
 * would imply a distinction the rules do not have.
 */
export type DicePair = readonly [DieValue, DieValue];

/**
 * Narrows an untrusted number to a die face.
 *
 * The domain never trusts a value that crossed a boundary. Phase 3 validates
 * the wire with Zod; this guard is the domain's own, independent check, so a
 * value arriving from a database document or a test fixture is narrowed by the
 * same rule.
 */
export function isDieValue(value: unknown): value is DieValue {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= DIE_MIN_VALUE &&
    value <= DIE_MAX_VALUE
  );
}
