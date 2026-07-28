import { z } from 'zod';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '../../core/domain/user';

/**
 * Authentication wire contracts.
 *
 * Shape lives here, rules live in the domain — the same 400-vs-422 split the
 * rest of the API uses. A password that is too short is a malformed request
 * (400); a username that is already taken is a well-formed request the domain
 * refuses (409).
 */
const username = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_PATTERN, 'Username may contain only letters, digits, underscore and hyphen.');

/**
 * No composition rules beyond a length floor, deliberately: complexity rules
 * push people towards `Passw0rd!` and are worse than length. The upper bound
 * exists because the KDF is intentionally slow and an unbounded input is a
 * denial-of-service vector.
 */
const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

export const credentialsBodySchema = z.object({ username, password }).strict();

export type CredentialsBody = z.infer<typeof credentialsBodySchema>;

export interface PlayerResponse {
  readonly id: string;
  readonly username: string;
  /** Extra #1 — how many games this player has won. */
  readonly wins: number;
}

export interface SessionResponse {
  readonly player: PlayerResponse;
  /** Bearer credential. Sent once; the client stores it and replays it. */
  readonly token: string;
}
