import { type DicePair } from '../dice';
import { type GameEffect, type GameState } from '../game';

/**
 * The identity of the rules a game is played under.
 *
 * Persisted on every game document so a finished match stays readable after the
 * rules evolve — a game recorded under `standard@1` is still scored by
 * `standard@1` when it is read back, even if `standard@2` exists by then. The
 * ref is *data*; the policy it names is resolved through an allow-list in
 * `./registry`.
 */
export interface RulesetRef {
  readonly id: string;
  readonly version: number;
}

/**
 * What a throw does to the round, decided by the ruleset and by nothing else.
 *
 * The engine switches on this and never inspects the dice itself. That is the
 * separation the testing convention depends on: a rules test asserts "6 and 6
 * produces `LOSE_ROUND_AND_PASS`", an engine test asserts "`LOSE_ROUND_AND_PASS`
 * clears the round score and switches player". Changing a rule then cannot break
 * an engine test, and vice versa.
 *
 * The `effect` travels with the outcome because naming it is a rules decision,
 * not an engine one. `standard@1` calls a lost round `DOUBLE_SIX` because under
 * `standard@1` that is what causes it; a ruleset that lost a round on 5 and 5
 * would say so here, and the engine would publish whatever it was told without
 * needing to change. An engine that hardcoded `DOUBLE_SIX` would quietly
 * mislabel every future ruleset — and animate the wrong thing on the client.
 */
export type RollOutcome =
  | { readonly type: 'ADD_TO_ROUND'; readonly points: number; readonly effect: GameEffect }
  | { readonly type: 'LOSE_ROUND_AND_PASS'; readonly effect: GameEffect };

/**
 * A scoring policy.
 *
 * Deliberately a plain interface with no dependencies of its own: an
 * implementation is a frozen literal, never a class reading configuration, and
 * never something loaded from a database. See `./registry` for why that matters.
 */
export interface GameRules {
  /** Stable family name, e.g. `standard`. Paired with `version` it is the ref. */
  readonly id: string;
  /** Bumped whenever scoring changes in a way that would rescore old games. */
  readonly version: number;

  /** Used when a game is created without an explicit winning score. */
  readonly defaultWinningScore: number;
  readonly minimumWinningScore: number;
  readonly maximumWinningScore: number;

  /** Scores one throw of the pair. Pure: same dice, same outcome, always. */
  evaluateRoll(dice: DicePair): RollOutcome;

  /**
   * Whether the *active* player may bank right now.
   *
   * Identity and turn order are the engine's business and are enforced before
   * this is ever consulted; the policy is asked only whether the position on the
   * board permits a hold.
   */
  canHold(state: GameState): boolean;

  /** Whether a banked total ends the game. */
  hasWon(globalScore: number, winningScore: number): boolean;
}
