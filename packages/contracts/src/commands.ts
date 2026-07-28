import { z } from 'zod';

import { idSchema, revisionSchema, winningScoreSchema } from './primitives.js';

/**
 * The five commands. Between them they are the entire write surface of the API.
 *
 * Note what is absent: no command carries a player id, a die value, a score, or
 * a turn. Dice are generated server-side, the actor is the bearer of the token,
 * and legality is decided by the server. There is no field here through which a
 * modified client could smuggle a rule.
 *
 * Every state-changing command carries `expectedRevision`. The server updates
 * on `{ _id, revision }` and increments atomically; a mismatch is a
 * `GAME_REVISION_CONFLICT` and the action is *not* replayed. This is what makes
 * a double-clicked Roll produce one roll, and what makes two seats on one page
 * safe without any live synchronisation.
 */

export const createGameRequestSchema = z
  .object({
    /** Chosen from `GET /api/users`. Must not be the creator. */
    opponentId: idSchema,
    /** Omitted means the server default of 100. Frozen for the match once set. */
    winningScore: winningScoreSchema.optional(),
  })
  .strict();

export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;

export const rollRequestSchema = z.object({ expectedRevision: revisionSchema }).strict();
export type RollRequest = z.infer<typeof rollRequestSchema>;

export const holdRequestSchema = z.object({ expectedRevision: revisionSchema }).strict();
export type HoldRequest = z.infer<typeof holdRequestSchema>;

/**
 * Start the next game between the same two players.
 *
 * Preserves both players and their win counts; resets global scores, round
 * score, last roll and winner; increments the game number. May raise or lower
 * the winning score for the new game only.
 *
 * Legal at any time, including mid-game — the assignment requires it.
 */
export const newGameRequestSchema = z
  .object({
    expectedRevision: revisionSchema,
    winningScore: winningScoreSchema.optional(),
  })
  .strict();

export type NewGameRequest = z.infer<typeof newGameRequestSchema>;

export const gameIdParamSchema = z.object({ gameId: idSchema }).strict();
export type GameIdParam = z.infer<typeof gameIdParamSchema>;
