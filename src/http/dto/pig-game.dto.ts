import { z } from 'zod';

import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_PATTERN } from '../../core/domain/user';
import type { PlayerResponse } from './auth.dto';

/**
 * Pig game wire contracts.
 *
 * Roll and hold accept **no request body at all** — every in-match rule lives
 * server-side and the actor is the authenticated identity, so there is nothing
 * a modified client could send to influence a score or steal a turn.
 *
 * NEW GAME is the sole exception: it names the opponent and may name the
 * winning score. That is setup, chosen before play, validated at the edge
 * (shape) and in the domain (rule), and frozen for the match.
 */
export const newPigGameBodySchema = z
  .object({
    opponent: z
      .string()
      .trim()
      .min(USERNAME_MIN_LENGTH)
      .max(USERNAME_MAX_LENGTH)
      .regex(USERNAME_PATTERN),
    /**
     * Shape and a sane absolute ceiling only; the playable range (2–1000) is
     * the domain's rule and violating it is a 422, mirroring how `rounds`
     * works on the rounds game.
     */
    targetScore: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export type NewPigGameBody = z.infer<typeof newPigGameBodySchema>;

export interface PigGameResponse {
  /** The two seated players, index-aligned with `totalScores`. */
  readonly players: readonly [PlayerResponse, PlayerResponse];
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: 0 | 1;
  readonly isPlaying: boolean;
  readonly winner: 0 | 1 | null;
  /** Both faces of the last throw, or null before the first roll of a match. */
  readonly lastRoll: readonly [number, number] | null;
  /** Whether that throw was a double six. Server-decided, client-rendered. */
  readonly bustedOnLastRoll: boolean;
  /** The match's win condition — chosen at NEW GAME, immutable during play. */
  readonly targetScore: number;
  /** Which seat the *calling* player occupies, or null if they are watching. */
  readonly viewerSeat: 0 | 1 | null;
}
