import { z } from 'zod';

/**
 * Pig game wire contracts.
 *
 * Roll and hold still accept **no client input at all** — every in-match rule
 * lives server-side, so there is nothing a modified client could send to
 * influence a score. The single exception is game *setup*: NEW GAME may name
 * the target score. That is configuration chosen before play, validated at
 * the edge (shape) and in the domain (rule), and frozen for the match — it
 * can never change a game already in progress.
 */
export const newPigGameBodySchema = z
  .object({
    /**
     * Shape and a sane absolute ceiling only; the playable range (2–1000) is
     * the domain's rule and violating it is a 422, mirroring how `rounds`
     * works on the rounds game.
     */
    targetScore: z.number().int().min(1).max(10_000).optional(),
  })
  .strict()
  // Actions may arrive with no body at all; that means "use the default".
  .default({});

export type NewPigGameBody = z.infer<typeof newPigGameBodySchema>;

export interface PigGameResponse {
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: 0 | 1;
  readonly isPlaying: boolean;
  readonly winner: 0 | 1 | null;
  readonly lastRoll: number | null;
  /** The match's win condition — chosen at NEW GAME, immutable during play. */
  readonly targetScore: number;
}
