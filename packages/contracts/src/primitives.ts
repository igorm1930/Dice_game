import { z } from 'zod';

/**
 * Scalars and bounds shared by every request and response.
 *
 * Every bound lives here exactly once. The previous generation of this project
 * enforced the winning-score range at three sites with three different values;
 * that was a deliberate layering, but it belongs in one file so the layering is
 * visible rather than discovered.
 */

/** A single die face. Two dice are thrown per roll, always. */
export const dieValueSchema = z.number().int().min(1).max(6);
export type DieValue = z.infer<typeof dieValueSchema>;

/** The pair thrown on every Roll. */
export const dicePairSchema = z.tuple([dieValueSchema, dieValueSchema]);
export type DicePair = z.infer<typeof dicePairSchema>;

/**
 * Which of the two chairs a player occupies. A seat is an index into the
 * `players` tuple, never a user id — identity is resolved server-side.
 */
export const seatSchema = z.union([z.literal(0), z.literal(1)]);
export type Seat = z.infer<typeof seatSchema>;

/**
 * Winning-score bounds.
 *
 * The minimum is 2 rather than 10 so an end-to-end test can win a match in a
 * single hold with deterministic dice, instead of scripting a dozen rounds for
 * no additional coverage.
 */
export const MIN_WINNING_SCORE = 2;
export const MAX_WINNING_SCORE = 1000;
export const DEFAULT_WINNING_SCORE = 100;

export const winningScoreSchema = z
  .number()
  .int()
  .min(MIN_WINNING_SCORE)
  .max(MAX_WINNING_SCORE);

/**
 * Optimistic concurrency token. The client echoes the revision it rendered; the
 * server rejects the action if the stored document has moved on.
 */
export const revisionSchema = z.number().int().nonnegative();

/** Mongo ObjectId as it appears on the wire. */
export const idSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Must be a 24-character hex id');

export const EMAIL_MAX_LENGTH = 254;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(EMAIL_MAX_LENGTH)
  .email();

export const DISPLAY_NAME_MIN_LENGTH = 3;
export const DISPLAY_NAME_MAX_LENGTH = 24;

export const displayNameSchema = z
  .string()
  .trim()
  .min(DISPLAY_NAME_MIN_LENGTH)
  .max(DISPLAY_NAME_MAX_LENGTH)
  .regex(/^[\p{L}\p{N} ._-]+$/u, 'Letters, numbers, spaces, dots, underscores and hyphens only');

export const PASSWORD_MIN_LENGTH = 10;

/**
 * The upper bound is a denial-of-service control, not a usability opinion:
 * the password hash is deliberately slow, so an unbounded input is a way to
 * spend the server's CPU for the price of one request.
 */
export const PASSWORD_MAX_LENGTH = 200;

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** ISO-8601 timestamp, always UTC. */
export const timestampSchema = z.string().datetime();
