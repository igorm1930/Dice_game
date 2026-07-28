import { type DicePair, isDieValue } from '../../domain/dice';
import { type DiceGenerator } from '../ports/dice-generator.port';

/**
 * A scripted sequence of throws, for unit tests and for Playwright.
 *
 * **This class must never be reachable in production.** It is bound only when
 * `NODE_ENV === 'test'` — see `dice-generator.provider.ts`, and the test beside
 * it that asserts a production container resolves {@link CryptoDiceGenerator}
 * instead. A test-only cheat that ships is a cheat: an opponent who knew the
 * sequence would know every roll before it happened.
 *
 * Deliberately **not** `@Injectable()`. It is never constructed by the
 * container; the provider factory news it up in the one branch that is allowed
 * to. Leaving the decorator off means a stray `useClass: DeterministicDiceGenerator`
 * would not even resolve.
 *
 * The sequence cycles rather than running out. An e2e run may take more turns
 * than the script names, and "the dice generator threw halfway through a
 * scenario" is a worse failure than a repeat.
 */

/**
 * The default script.
 *
 * Chosen so that the first throw banks enough to win at `MIN_WINNING_SCORE`
 * (2) in a single hold — which is why that minimum is 2 — and so that a double
 * six appears early enough for an e2e run to exercise the bust animation
 * without scripting a dozen rounds.
 */
export const DEFAULT_DICE_SEQUENCE: readonly DicePair[] = Object.freeze([
  [3, 4],
  [1, 2],
  [5, 2],
  [6, 6],
  [2, 3],
  [4, 1],
]);

export class DeterministicDiceGenerator implements DiceGenerator {
  private sequence: readonly DicePair[];
  private cursor = 0;

  constructor(sequence: readonly DicePair[] = DEFAULT_DICE_SEQUENCE) {
    this.sequence = assertPlayable(sequence);
  }

  rollPair(): DicePair {
    const pair = this.sequence[this.cursor % this.sequence.length];

    if (pair === undefined) {
      // Unreachable: the sequence is non-empty by construction. Present because
      // `noUncheckedIndexedAccess` is on, and silently substituting a face here
      // would be the one bug this class exists to make impossible.
      throw new Error('Deterministic dice sequence is empty.');
    }

    this.cursor += 1;

    return pair;
  }

  /** How many throws have been taken. Lets a test assert none were wasted. */
  get throwCount(): number {
    return this.cursor;
  }

  /** Replaces the script and rewinds. */
  setSequence(sequence: readonly DicePair[]): void {
    this.sequence = assertPlayable(sequence);
    this.cursor = 0;
  }

  /** Rewinds to the start of the current script. */
  reset(): void {
    this.cursor = 0;
  }
}

/**
 * A script of impossible faces would produce a game state the contract cannot
 * serialise, and the failure would surface as a response-validation error a long
 * way from the fixture that caused it.
 */
function assertPlayable(sequence: readonly DicePair[]): readonly DicePair[] {
  if (sequence.length === 0) {
    throw new Error('A deterministic dice sequence must contain at least one throw.');
  }

  for (const pair of sequence) {
    if (!isDieValue(pair[0]) || !isDieValue(pair[1])) {
      throw new Error(
        `Scripted throw [${String(pair[0])}, ${String(pair[1])}] is not a pair of die faces.`,
      );
    }
  }

  return Object.freeze([...sequence]);
}
