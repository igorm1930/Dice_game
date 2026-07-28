import type { DieValue } from './dice';
import { DomainError } from './errors';

/** Which of the two chairs at the table a player occupies. */
export type PigSeat = 0 | 1;

/**
 * The face that busts a turn — but only when **both** dice show it.
 * A single 6 is worth 6 points like any other face.
 */
export const PIG_BUST_DIE: DieValue = 6;

/** Bounds for a playable winning score. */
export const PIG_MIN_TARGET_SCORE = 2;
export const PIG_MAX_TARGET_SCORE = 1000;

/** The pair of dice thrown on every roll. */
export type PigDiceRoll = readonly [DieValue, DieValue];

/**
 * A seated player: the identity that occupies a chair, denormalised with the
 * username it had when the match began. The name is a snapshot on purpose —
 * a scoreboard should still read correctly if a player renames later.
 */
export interface PigSeatedPlayer {
  readonly id: string;
  readonly username: string;
}

/**
 * The Pig game state.
 *
 * One shared match: the exercise explicitly simulates both players on the same
 * page, so a single table with two named seats models it exactly, and every
 * client renders the same server-owned truth.
 *
 * Immutable by construction — transitions return new frozen snapshots.
 */
export interface PigGameState {
  /** The two identities seated at this match, index-aligned with the scores. */
  readonly players: readonly [PigSeatedPlayer, PigSeatedPlayer];
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: PigSeat;
  readonly isPlaying: boolean;
  readonly winner: PigSeat | null;
  /**
   * The two faces last thrown. Lives in server state because the client renders
   * it without computing anything — the dice are data, not logic.
   */
  readonly lastRoll: PigDiceRoll | null;
  /**
   * Whether that last roll was a double six. A derived fact, but derived *here*
   * so the frontend can show the "round lost" moment without ever re-deciding
   * what a bust is (the requirement is that no game logic lives in the client).
   */
  readonly bustedOnLastRoll: boolean;
  /**
   * Total at which the active player wins. Chosen when the match is created and
   * immutable for its duration — setup is the one legitimate client input, and
   * it can never change the rules of a game already in progress.
   */
  readonly targetScore: number;
  /** Optimistic concurrency token, incremented by the repository on write. */
  readonly version: number;
}

/** Raised when any action is attempted before a match has been started. */
export class NoGameInProgressError extends DomainError {
  readonly code = 'PIG_GAME_NOT_FOUND';

  constructor() {
    super('No game has been started yet. Start a new game first.');
  }
}

/**
 * Raised when an action is attempted after the game has been won.
 *
 * The UI disables its buttons at that point, but the backend is the source of
 * truth — a client that bypasses the UI still cannot play a finished game.
 */
export class PigGameOverError extends DomainError {
  readonly code = 'PIG_GAME_OVER';

  constructor(action: string, winner: PigSeat | null) {
    super(
      `Cannot ${action}: the game has already been won by player ${String(winner)}. Start a new game first.`,
      { action, winner },
    );
  }
}

/** Raised when an authenticated user who is not seated tries to play. */
export class NotAParticipantError extends DomainError {
  readonly code = 'NOT_A_PARTICIPANT';

  constructor(userId: string) {
    super('You are not one of the two players in this game.', { userId });
  }
}

/**
 * Raised when a seated player acts out of turn.
 *
 * This is the rule that makes "the API validates turns" true rather than
 * aspirational: turn order is enforced against the caller's *identity*, so no
 * amount of clicking in the wrong browser tab can steal a turn.
 */
export class NotYourTurnError extends DomainError {
  readonly code = 'NOT_YOUR_TURN';

  constructor(action: string, actor: PigSeat, activePlayer: PigSeat) {
    super(`Cannot ${action}: it is player ${String(activePlayer)}'s turn.`, {
      action,
      actor,
      activePlayer,
    });
  }
}

/** Raised when a new game is requested with an unplayable winning score. */
export class InvalidTargetScoreError extends DomainError {
  readonly code = 'INVALID_TARGET_SCORE';

  constructor(requested: number) {
    super(
      `Winning score ${String(requested)} must be an integer between ${String(PIG_MIN_TARGET_SCORE)} and ${String(PIG_MAX_TARGET_SCORE)}.`,
      { requested, min: PIG_MIN_TARGET_SCORE, max: PIG_MAX_TARGET_SCORE },
    );
  }
}

/** Raised when a player tries to start a match against themselves. */
export class InvalidOpponentError extends DomainError {
  readonly code = 'INVALID_OPPONENT';

  constructor(username: string) {
    super(`'${username}' cannot play against themselves; name a different opponent.`, { username });
  }
}

function otherSeat(seat: PigSeat): PigSeat {
  return seat === 0 ? 1 : 0;
}

/** Returns the seat this user occupies, or `null` if they are a spectator. */
export function seatOf(state: PigGameState, userId: string): PigSeat | null {
  if (state.players[0].id === userId) {
    return 0;
  }
  if (state.players[1].id === userId) {
    return 1;
  }
  return null;
}

/**
 * Creates a match between two seated players.
 *
 * @throws {InvalidTargetScoreError} if the winning score is not playable.
 * @throws {InvalidOpponentError} if both seats are the same identity.
 */
export function createPigGame(
  players: readonly [PigSeatedPlayer, PigSeatedPlayer],
  targetScore: number,
): PigGameState {
  if (
    !Number.isInteger(targetScore) ||
    targetScore < PIG_MIN_TARGET_SCORE ||
    targetScore > PIG_MAX_TARGET_SCORE
  ) {
    throw new InvalidTargetScoreError(targetScore);
  }

  if (players[0].id === players[1].id) {
    throw new InvalidOpponentError(players[0].username);
  }

  return Object.freeze({
    players: Object.freeze<[PigSeatedPlayer, PigSeatedPlayer]>([
      Object.freeze({ ...players[0] }),
      Object.freeze({ ...players[1] }),
    ]),
    totalScores: Object.freeze<[number, number]>([0, 0]),
    currentTurnScore: 0,
    activePlayer: 0,
    isPlaying: true,
    winner: null,
    lastRoll: null,
    bustedOnLastRoll: false,
    targetScore,
    version: 0,
  });
}

/**
 * Guards that `actor` may act on this state at all, returning their seat.
 *
 * @throws {PigGameOverError} if the match is already decided.
 * @throws {NotAParticipantError} if the caller is not seated.
 * @throws {NotYourTurnError} if it is the other player's turn.
 */
export function requireTurn(state: PigGameState, actor: string, action: string): PigSeat {
  if (!state.isPlaying) {
    throw new PigGameOverError(action, state.winner);
  }

  const seat = seatOf(state, actor);
  if (seat === null) {
    throw new NotAParticipantError(actor);
  }

  if (seat !== state.activePlayer) {
    throw new NotYourTurnError(action, seat, state.activePlayer);
  }

  return seat;
}

/** True when a throw is a double six — the only losing combination. */
export function isBust(roll: PigDiceRoll): boolean {
  return roll[0] === PIG_BUST_DIE && roll[1] === PIG_BUST_DIE;
}

/**
 * Applies one throw of the two dice on behalf of `actor`.
 *
 *  - **6 & 6** busts: the round score is lost and the turn passes. (Merely
 *    passing the turn without the wipe would hand the pending points to the
 *    opponent, which makes no sense.)
 *  - Anything else adds the sum of both dice to the round score, and the same
 *    player may keep rolling.
 *
 * @throws {PigGameOverError | NotAParticipantError | NotYourTurnError}
 */
export function applyRoll(state: PigGameState, actor: string, roll: PigDiceRoll): PigGameState {
  requireTurn(state, actor, 'roll');

  const dice = Object.freeze<[DieValue, DieValue]>([roll[0], roll[1]]);

  if (isBust(roll)) {
    return Object.freeze({
      ...state,
      currentTurnScore: 0,
      activePlayer: otherSeat(state.activePlayer),
      lastRoll: dice,
      bustedOnLastRoll: true,
    });
  }

  return Object.freeze({
    ...state,
    currentTurnScore: state.currentTurnScore + roll[0] + roll[1],
    lastRoll: dice,
    bustedOnLastRoll: false,
  });
}

/**
 * Banks the round score into the active player's global score.
 *
 * Reaching the winning score wins immediately; otherwise the turn passes.
 * Holding on a zero round score is legal — it simply forfeits the turn.
 *
 * @throws {PigGameOverError | NotAParticipantError | NotYourTurnError}
 */
export function applyHold(state: PigGameState, actor: string): PigGameState {
  const seat = requireTurn(state, actor, 'hold');

  const totals: [number, number] = [state.totalScores[0], state.totalScores[1]];
  totals[seat] += state.currentTurnScore;

  const hasWon = totals[seat] >= state.targetScore;

  return Object.freeze({
    ...state,
    totalScores: Object.freeze<[number, number]>(totals),
    currentTurnScore: 0,
    activePlayer: hasWon ? seat : otherSeat(seat),
    isPlaying: !hasWon,
    winner: hasWon ? seat : null,
    bustedOnLastRoll: false,
  });
}
