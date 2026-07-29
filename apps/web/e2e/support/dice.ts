import { type DicePair, type GameView, MAX_WINNING_SCORE } from '@dice-game/contracts';
import { type APIRequestContext } from '@playwright/test';

import { createGame, registerPlayer, rollAs } from './api';

/**
 * The scripted dice, and how a test gets to a known point in them.
 *
 * `NODE_ENV=test` binds `DeterministicDiceGenerator`, and that generator is a
 * **singleton in the API process**: one cursor, shared by every game, cycling
 * forever. Two consequences follow, and both are the reason this file exists.
 *
 *  1. Tests cannot run in parallel. Two workers rolling at once would interleave
 *     their draws. `playwright.config.ts` pins `workers: 1`.
 *  2. A test cannot assume it starts at the beginning of the script, because the
 *     test before it left the cursor wherever its last roll put it. So every
 *     test *aligns* first: it rolls a scratch game of its own until the last
 *     pair in the script comes up, which leaves the next real roll on the first.
 *
 * Without step 2 every scenario would silently depend on the order and the exact
 * roll count of every scenario before it, and `--grep` would be a trap.
 */

/**
 * `DEFAULT_DICE_SEQUENCE` from
 * `apps/api/src/games/adapters/deterministic-dice.generator.ts`.
 *
 * Restated rather than imported — `apps/web` may not reach into `apps/api` —
 * which makes it a copy that could drift. {@link alignDice} closes that hole: it
 * checks every pair it draws against this table, in order, so a change to the
 * API's script fails here with the two sequences printed side by side instead of
 * turning up as an unexplained "expected 7, got 5" three tests later.
 */
export const DICE_SCRIPT = [
  [3, 4],
  [1, 2],
  [5, 2],
  [6, 6],
  [2, 3],
  [4, 1],
] as const;

/**
 * The round score after the given throws of the script, in order.
 *
 * `roundScoreAfter(0, 1)` is "the first two throws" — 3+4 then 1+2, so 10. The
 * expectations in the specs are written this way rather than as literals so that
 * they are visibly *derived from the dice*, which is the thing the assertion is
 * about. A double six is not summed here; it zeroes the round, and the specs say
 * so explicitly.
 */
export function roundScoreAfter(...throws: number[]): number {
  return throws.reduce((total, index) => {
    const pair = DICE_SCRIPT[index];

    if (pair === undefined) {
      throw new RangeError(`The deterministic script has no throw at index ${index}.`);
    }

    return total + pair[0] + pair[1];
  }, 0);
}

function formatPair(pair: DicePair | readonly [number, number] | null): string {
  return pair === null ? 'nothing' : `[${pair[0]}, ${pair[1]}]`;
}

function indexOfPair(pair: DicePair | null): number {
  if (pair === null) {
    return -1;
  }

  return DICE_SCRIPT.findIndex(([left, right]) => left === pair[0] && right === pair[1]);
}

/**
 * A match that exists only to be rolled.
 *
 * Opened **once per worker**, not once per test. Two accounts and a match are
 * cheap, but they are not free: `GET /api/users` is what fills the opponent
 * picker and it is paginated at 25, so a suite that minted two throwaway players
 * per test would eventually push the players a scenario actually needs off the
 * first page of its own picker.
 *
 * It is played at `MAX_WINNING_SCORE` and never held, so both banked scores stay
 * at zero and it can never end — which is what makes reusing it safe.
 */
export interface ScratchMatch {
  readonly tokens: readonly [string, string];
  view: GameView;
}

export async function openScratchMatch(api: APIRequestContext): Promise<ScratchMatch> {
  const one = await registerPlayer(api, 'Align');
  const two = await registerPlayer(api, 'Align');

  return {
    tokens: [one.accessToken, two.accessToken],
    view: await createGame(api, one.accessToken, two.userId, MAX_WINNING_SCORE),
  };
}

/**
 * Leaves the API's dice cursor at the start of {@link DICE_SCRIPT}.
 *
 * At most one full cycle is needed, and the walk is checked as it goes: each
 * pair must be the one the script says follows the last.
 */
export async function alignDice(api: APIRequestContext, scratch: ScratchMatch): Promise<void> {
  const { tokens } = scratch;
  let view = scratch.view;
  const seen: string[] = [];
  let previous = -1;
  // Annotated, because `DICE_SCRIPT.length` on a `readonly` tuple is the
  // literal type 6, and a counter that TypeScript believes can only ever be 6
  // makes the loop condition look like a mistake.
  let remaining: number = DICE_SCRIPT.length;

  while (remaining > 0) {
    remaining -= 1;
    view = await rollAs(api, tokens[view.activePlayer], view);
    // Written back immediately: the next alignment continues this same match,
    // and a stale revision would be refused with GAME_REVISION_CONFLICT.
    scratch.view = view;

    const index = indexOfPair(view.lastDice);

    seen.push(formatPair(view.lastDice));

    if (index === -1) {
      throw new Error(
        `The API threw ${formatPair(view.lastDice)}, which is not in the deterministic script ` +
          `${DICE_SCRIPT.map(formatPair).join(' ')}. Either DICE_SOURCE=scripted did not ` +
          'reach the API — in which case these are real dice and nothing here can hold — or the ' +
          'script in deterministic-dice.generator.ts changed and DICE_SCRIPT has to change ' +
          'with it.',
      );
    }

    if (previous !== -1 && index !== (previous + 1) % DICE_SCRIPT.length) {
      throw new Error(
        `The deterministic script no longer runs in the order this suite expects. Drew ` +
          `${seen.join(' ')} against ${DICE_SCRIPT.map(formatPair).join(' ')}.`,
      );
    }

    if (index === DICE_SCRIPT.length - 1) {
      // The last pair of the cycle has just been consumed, so the next throw —
      // the first one the test itself makes — is DICE_SCRIPT[0].
      return;
    }

    previous = index;
  }

  throw new Error(
    `Rolled a full cycle (${seen.join(' ')}) without reaching ` +
      `${formatPair(DICE_SCRIPT[DICE_SCRIPT.length - 1] ?? null)}, so the dice cursor could not be aligned.`,
  );
}
