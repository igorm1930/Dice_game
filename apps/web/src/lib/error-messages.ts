import { type ErrorCode, MAX_WINNING_SCORE, MIN_WINNING_SCORE } from '@dice-game/contracts';

import { ApiError } from './api-client';

/**
 * One sentence per error code, for a player rather than for a log.
 *
 * A `Record<ErrorCode, string>` rather than a lookup with a fallback: adding a
 * code to the contract stops this file compiling, which is the point. The
 * server's own `message` is not shown — it is written for an API consumer, and
 * one of them (`INVALID_CREDENTIALS`) is deliberately identical for two
 * different causes so that login cannot be used to enumerate accounts.
 *
 * The two bounds quoted here come from the contract. Writing "2 and 1000" by
 * hand would be a third copy of a number the contract already owns.
 */
const MESSAGES: Readonly<Record<ErrorCode, string>> = Object.freeze({
  VALIDATION_ERROR: 'Some of those details were not accepted. Check the fields and try again.',
  MALFORMED_REQUEST_BODY: 'That request could not be read. Please try again.',

  UNAUTHENTICATED: 'This seat is signed out. Sign in again to carry on.',
  INVALID_CREDENTIALS: 'That email and password combination was not recognised.',

  NOT_A_PARTICIPANT: 'This seat is not one of the two players in this match.',
  NOT_YOUR_TURN: 'It is the other player’s turn.',

  GAME_NOT_FOUND: 'That match no longer exists.',
  USER_NOT_FOUND: 'That player could not be found.',
  ROUTE_NOT_FOUND: 'The client asked for something the server does not offer.',

  EMAIL_TAKEN: 'An account already exists for that email address.',
  GAME_OVER: 'This game has already been won.',
  GAME_REVISION_CONFLICT: 'The board moved on. Refreshing this seat’s view.',

  PAYLOAD_TOO_LARGE: 'That request was too large.',

  INVALID_TARGET_SCORE: `The winning score must be between ${MIN_WINNING_SCORE} and ${MAX_WINNING_SCORE}.`,
  INVALID_OPPONENT: 'Pick a different opponent — you cannot play against yourself.',
  HOLD_NOT_AVAILABLE: 'Holding is not available right now.',
  UNSUPPORTED_RULESET: 'This match was played under rules this server no longer supports.',

  RATE_LIMIT_EXCEEDED: 'Too many attempts. Wait a moment and try again.',
  INTERNAL_SERVER_ERROR: 'Something went wrong on the server. Please try again.',
});

/** A message for anything thrown by the API layer, including a transport failure. */
export function messageFor(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return MESSAGES.INTERNAL_SERVER_ERROR;
  }

  if (error.kind === 'transport') {
    return error.message;
  }

  return MESSAGES[error.code];
}

/** The machine-readable code, for the small print under a message. */
export function codeFor(error: unknown): ErrorCode | null {
  return error instanceof ApiError ? error.code : null;
}
