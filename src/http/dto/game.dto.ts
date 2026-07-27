import { z } from 'zod';

/**
 * Request contracts.
 *
 * Validation lives at the edge and nowhere else: once a payload clears these
 * schemas, the inner layers work with types that are correct by construction
 * and never re-check. `.strict()` rejects unknown keys so a typo'd field is a
 * 400 rather than a silently ignored setting.
 */

const playerNameSchema = z
  .string()
  .trim()
  .min(1, 'playerName must not be empty')
  .max(64, 'playerName must be at most 64 characters')
  .regex(
    /^[\p{L}\p{N} ._-]+$/u,
    'playerName may only contain letters, numbers, spaces, dots, underscores and hyphens',
  );

export const createGameBodySchema = z
  .object({
    playerName: playerNameSchema,
    /**
     * Optional. The upper bound is re-checked in the domain against configured
     * limits; this schema only enforces the shape and a sane absolute ceiling.
     */
    rounds: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type CreateGameBody = z.infer<typeof createGameBodySchema>;

export const gameIdParamsSchema = z
  .object({
    gameId: z.string().uuid('gameId must be a valid UUID'),
  })
  .strict();

export type GameIdParams = z.infer<typeof gameIdParamsSchema>;

export const listGamesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type ListGamesQuery = z.infer<typeof listGamesQuerySchema>;

export const leaderboardQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict();

export type LeaderboardQuery = z.infer<typeof leaderboardQuerySchema>;

/**
 * Response contracts.
 *
 * Declared explicitly rather than serialising the aggregate directly. An entity
 * is an internal model; the moment it is returned as-is, every future field
 * added to it becomes an unplanned, unversioned public API change.
 */
export interface RoundResponse {
  readonly index: number;
  readonly dice: readonly [number, number];
  readonly pips: number;
  readonly outcome: string;
  readonly points: number;
  readonly scoreAfter: number;
  readonly rolledAt: string;
}

export interface GameResponse {
  readonly id: string;
  readonly playerName: string;
  readonly status: string;
  readonly totalRounds: number;
  readonly roundsPlayed: number;
  readonly roundsRemaining: number;
  readonly totalScore: number;
  readonly rounds: readonly RoundResponse[];
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface RollResponse {
  readonly round: RoundResponse;
  readonly game: GameResponse;
}

export interface LeaderboardEntryResponse {
  readonly rank: number;
  readonly gameId: string;
  readonly playerName: string;
  readonly totalScore: number;
  readonly totalRounds: number;
  readonly completedAt: string | null;
}
