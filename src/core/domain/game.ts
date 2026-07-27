import type { DiceRoll } from './dice';
import { GameAlreadyCompletedError, InvalidRoundCountError } from './errors';
import { type RollOutcome, scoreRoll } from './scoring';

export const GameStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
} as const;

export type GameStatus = (typeof GameStatus)[keyof typeof GameStatus];

export interface Round {
  /** 1-based position of this round within the game. */
  readonly index: number;
  readonly dice: DiceRoll;
  readonly pips: number;
  readonly outcome: RollOutcome;
  readonly points: number;
  /** Running total after this round — precomputed so read paths never fold. */
  readonly scoreAfter: number;
  readonly rolledAt: string;
}

/**
 * The Game aggregate.
 *
 * Immutable by construction: every transition returns a new snapshot rather
 * than mutating in place. This eliminates a whole class of aliasing bugs when
 * the same object is reachable from a repository, a service, and a response
 * mapper at the same time.
 */
export interface Game {
  readonly id: string;
  readonly playerName: string;
  readonly status: GameStatus;
  readonly totalRounds: number;
  readonly rounds: readonly Round[];
  readonly totalScore: number;
  readonly createdAt: string;
  readonly completedAt: string | null;
  /** Optimistic concurrency token. Incremented by the repository on write. */
  readonly version: number;
}

export interface CreateGameParams {
  readonly id: string;
  readonly playerName: string;
  readonly totalRounds: number;
  readonly maxRounds: number;
  readonly now: Date;
}

/**
 * Factory for a fresh game. Enforces the round-count invariant at the only
 * point where a Game can come into existence.
 */
export function createGame(params: CreateGameParams): Game {
  const { id, playerName, totalRounds, maxRounds, now } = params;

  if (!Number.isInteger(totalRounds) || totalRounds < 1 || totalRounds > maxRounds) {
    throw new InvalidRoundCountError(totalRounds, maxRounds);
  }

  return Object.freeze({
    id,
    playerName,
    status: GameStatus.IN_PROGRESS,
    totalRounds,
    rounds: Object.freeze([]),
    totalScore: 0,
    createdAt: now.toISOString(),
    completedAt: null,
    version: 0,
  });
}

export interface PlayRoundResult {
  readonly game: Game;
  readonly round: Round;
}

/**
 * Applies a roll to the game, returning the next snapshot and the round played.
 *
 * The game auto-completes on its final round — completion is a consequence of
 * the rules, not a separate endpoint a client could forget to call.
 *
 * @throws {GameAlreadyCompletedError} if every round has already been played.
 */
export function playRound(game: Game, dice: DiceRoll, now: Date): PlayRoundResult {
  if (game.status === GameStatus.COMPLETED) {
    throw new GameAlreadyCompletedError(game.id, game.totalRounds);
  }

  const score = scoreRoll(dice);
  const totalScore = game.totalScore + score.points;
  const index = game.rounds.length + 1;

  const round: Round = Object.freeze({
    index,
    dice: Object.freeze({ ...dice }),
    pips: score.pips,
    outcome: score.outcome,
    points: score.points,
    scoreAfter: totalScore,
    rolledAt: now.toISOString(),
  });

  const isFinalRound = index >= game.totalRounds;

  const next: Game = Object.freeze({
    ...game,
    rounds: Object.freeze([...game.rounds, round]),
    totalScore,
    status: isFinalRound ? GameStatus.COMPLETED : GameStatus.IN_PROGRESS,
    completedAt: isFinalRound ? now.toISOString() : null,
  });

  return { game: next, round };
}

export function remainingRounds(game: Game): number {
  return Math.max(0, game.totalRounds - game.rounds.length);
}
