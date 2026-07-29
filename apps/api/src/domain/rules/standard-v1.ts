import { type DicePair, type DieValue } from '../dice';
import { type GameState } from '../game';
import { type GameRules, type RollOutcome, type RulesetRef } from './game-rules';

/**
 * `standard@1` — the ruleset the written brief describes.
 *
 *  - Two dice are thrown on every Roll.
 *  - A normal roll adds **both** dice to the round score, and the same player
 *    may keep rolling.
 *  - **6 and 6** loses the round score and passes the turn. A *single* six is an
 *    ordinary six worth six points; only the pair is special. (Merely passing
 *    the turn without the wipe would hand the pending points to the opponent,
 *    which makes no sense.)
 *  - Hold banks the round score and passes the turn.
 *  - Reaching *or exceeding* the winning score wins, checked on Hold only.
 */

export const STANDARD_RULES_ID = 'standard';
export const STANDARD_RULES_VERSION = 1;

/** The ref that names this policy. Frozen: it is copied onto every game. */
export const STANDARD_RULESET_REF: RulesetRef = Object.freeze({
  id: STANDARD_RULES_ID,
  version: STANDARD_RULES_VERSION,
});

/**
 * The face that loses the round — but only when **both** dice show it.
 */
const BUST_FACE: DieValue = 6;

/**
 * Winning-score bounds and default.
 *
 * These repeat `DEFAULT_WINNING_SCORE`, `MIN_WINNING_SCORE` and
 * `MAX_WINNING_SCORE` from `@dice-game/contracts`, which the domain may not
 * import. The repetition is guarded by `src/rules-contract-agreement.test.ts`,
 * which fails the build if the two ever disagree.
 *
 * The minimum is 2 rather than 10 so an end-to-end test can win a match in a
 * single hold with deterministic dice, instead of scripting a dozen rounds for
 * no additional coverage.
 */
const DEFAULT_WINNING_SCORE = 100;
const MIN_WINNING_SCORE = 10;
const MAX_WINNING_SCORE = 1000;

export const standardRulesV1: GameRules = Object.freeze({
  id: STANDARD_RULES_ID,
  version: STANDARD_RULES_VERSION,

  defaultWinningScore: DEFAULT_WINNING_SCORE,
  minimumWinningScore: MIN_WINNING_SCORE,
  maximumWinningScore: MAX_WINNING_SCORE,

  evaluateRoll(dice: DicePair): RollOutcome {
    if (dice[0] === BUST_FACE && dice[1] === BUST_FACE) {
      // The effect is named here, alongside the combination it describes, so
      // that changing `BUST_FACE` changes the label with it. This file and its
      // test are the only two places that know a lost round means two sixes.
      return { type: 'LOSE_ROUND_AND_PASS', effect: 'DOUBLE_SIX' };
    }

    return { type: 'ADD_TO_ROUND', points: dice[0] + dice[1], effect: 'NORMAL_ROLL' };
  },

  /**
   * Holding on a **zero** round score is legal, and that is a decision rather
   * than an oversight. The brief asks for no restriction, and forbidding it
   * would remove a player's ability to voluntarily pass: the only remaining exit
   * from a turn would be to keep rolling until 6 and 6 comes up. Banking zero
   * and handing over the dice is a legitimate move.
   */
  canHold(state: GameState): boolean {
    return state.status === 'ACTIVE';
  },

  /** Reach *or exceed*: the brief says "reaches or exceeds the winning score". */
  hasWon(globalScore: number, winningScore: number): boolean {
    return globalScore >= winningScore;
  },
});
