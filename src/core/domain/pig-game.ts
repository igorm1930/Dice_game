import type { DieValue } from './dice';
import { DomainError } from './errors';

export type PigPlayer = 0 | 1;

/** The die face that ends a turn and wipes its score. */
export const PIG_BUST_DIE: DieValue = 6;

/** Bounds for a playable target score. */
export const PIG_MIN_TARGET_SCORE = 2;
export const PIG_MAX_TARGET_SCORE = 1000;

/**
 * The Pig game state.
 *
 * A deliberately singleton aggregate: there is exactly one shared game, which
 * is what makes the frontend trivially "dumb" — every client renders the same
 * server-owned truth, and two browser tabs literally play the same match.
 *
 * Immutable by construction, like the Game aggregate: transitions return new
 * frozen snapshots, never mutate.
 */
export interface PigGameState {
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: PigPlayer;
  readonly isPlaying: boolean;
  readonly winner: PigPlayer | null;
  /**
   * The face of the last die rolled. Lives in server state because the client
   * renders it without computing anything — the die image is data, not logic.
   */
  readonly lastRoll: DieValue | null;
  /**
   * Total at which the active player wins. Chosen when the game is created and
   * immutable for its duration — game *setup* is the one legitimate client
   * input, and it can never change the rules of a match already in progress.
   */
  readonly targetScore: number;
  /** Optimistic concurrency token, incremented by the repository on write. */
  readonly version: number;
}

/**
 * Raised when an action is attempted after the game has been won.
 *
 * The UI disables its buttons at that point, but the backend is the source of
 * truth — a client that bypasses the UI still cannot play a finished game.
 */
export class PigGameOverError extends DomainError {
  readonly code = 'PIG_GAME_OVER';

  constructor(action: string, winner: PigPlayer | null) {
    super(
      `Cannot ${action}: the game has already been won by player ${String(winner)}. Start a new game first.`,
      { action, winner },
    );
  }
}

/** Raised when a new game is requested with an unplayable target score. */
export class InvalidTargetScoreError extends DomainError {
  readonly code = 'INVALID_TARGET_SCORE';

  constructor(requested: number) {
    super(
      `Target score ${String(requested)} must be an integer between ${String(PIG_MIN_TARGET_SCORE)} and ${String(PIG_MAX_TARGET_SCORE)}.`,
      { requested, min: PIG_MIN_TARGET_SCORE, max: PIG_MAX_TARGET_SCORE },
    );
  }
}

function otherPlayer(player: PigPlayer): PigPlayer {
  return player === 0 ? 1 : 0;
}

export function createPigGame(targetScore: number): PigGameState {
  if (
    !Number.isInteger(targetScore) ||
    targetScore < PIG_MIN_TARGET_SCORE ||
    targetScore > PIG_MAX_TARGET_SCORE
  ) {
    throw new InvalidTargetScoreError(targetScore);
  }

  return Object.freeze({
    totalScores: Object.freeze<[number, number]>([0, 0]),
    currentTurnScore: 0,
    activePlayer: 0,
    isPlaying: true,
    winner: null,
    lastRoll: null,
    targetScore,
    version: 0,
  });
}

/**
 * Applies one die roll.
 *
 *  - A 6 busts: the current turn score is wiped and play switches. (Merely
 *    switching without the wipe would hand the pending points to the opponent,
 *    which makes no sense.)
 *  - 1–5 accumulate into the current turn score.
 *
 * @throws {PigGameOverError} if the game has already been won.
 */
export function applyRoll(state: PigGameState, die: DieValue): PigGameState {
  if (!state.isPlaying) {
    throw new PigGameOverError('roll', state.winner);
  }

  if (die === PIG_BUST_DIE) {
    return Object.freeze({
      ...state,
      currentTurnScore: 0,
      activePlayer: otherPlayer(state.activePlayer),
      lastRoll: die,
    });
  }

  return Object.freeze({
    ...state,
    currentTurnScore: state.currentTurnScore + die,
    lastRoll: die,
  });
}

/**
 * Banks the current turn score into the active player's total.
 *
 * Reaching the game's target score wins immediately; otherwise play switches.
 * Holding with a zero turn score is legal (it merely forfeits the turn).
 *
 * @throws {PigGameOverError} if the game has already been won.
 */
export function applyHold(state: PigGameState): PigGameState {
  if (!state.isPlaying) {
    throw new PigGameOverError('hold', state.winner);
  }

  const totals: [number, number] = [state.totalScores[0], state.totalScores[1]];
  totals[state.activePlayer] += state.currentTurnScore;

  const hasWon = totals[state.activePlayer] >= state.targetScore;

  return Object.freeze({
    ...state,
    totalScores: Object.freeze<[number, number]>(totals),
    currentTurnScore: 0,
    activePlayer: hasWon ? state.activePlayer : otherPlayer(state.activePlayer),
    isPlaying: !hasWon,
    winner: hasWon ? state.activePlayer : null,
  });
}
