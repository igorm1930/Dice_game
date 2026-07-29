import { z } from 'zod';

/**
 * The error taxonomy.
 *
 * A domain error carries a stable machine-readable code and never an HTTP
 * status — the mapping from one to the other lives in exactly one table, here,
 * so the delivery layer cannot invent a status and the client cannot be
 * surprised by one. (Carried forward from ADR-0005 of the previous generation,
 * where the ADR's table had already drifted four codes away from the shipped
 * map. Putting the table in the contract is what stops that recurring.)
 */
export const ERROR_CODES = [
  // 400 — the request could not be understood
  'VALIDATION_ERROR',
  'MALFORMED_REQUEST_BODY',

  // 401 — the caller is not authenticated
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',

  // 403 — authenticated, but not allowed to do this
  'NOT_A_PARTICIPANT',
  'NOT_YOUR_TURN',

  // 404 — no such thing, or none the caller may see
  'GAME_NOT_FOUND',
  'USER_NOT_FOUND',
  'ROUTE_NOT_FOUND',

  // 409 — the request conflicts with current state
  'EMAIL_TAKEN',
  'GAME_OVER',
  'GAME_REVISION_CONFLICT',

  // 413 / 422 — well-formed, but unacceptable
  'PAYLOAD_TOO_LARGE',
  'INVALID_TARGET_SCORE',
  'INVALID_OPPONENT',
  'HOLD_NOT_AVAILABLE',
  'UNSUPPORTED_RULESET',

  // 429 / 500
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_SERVER_ERROR',
] as const;

export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/**
 * The single code-to-status table.
 *
 * Exported from the contract rather than hidden in the API so that a test on
 * either side of the wire can assert the two agree, and so the client can
 * reason about a failure without pattern-matching on status codes.
 */
export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION_ERROR: 400,
  MALFORMED_REQUEST_BODY: 400,

  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,

  NOT_A_PARTICIPANT: 403,
  NOT_YOUR_TURN: 403,

  GAME_NOT_FOUND: 404,
  USER_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,

  EMAIL_TAKEN: 409,
  GAME_OVER: 409,
  GAME_REVISION_CONFLICT: 409,

  PAYLOAD_TOO_LARGE: 413,

  INVALID_TARGET_SCORE: 422,
  INVALID_OPPONENT: 422,
  HOLD_NOT_AVAILABLE: 422,
  UNSUPPORTED_RULESET: 422,

  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_SERVER_ERROR: 500,
});

/**
 * Codes the client should resolve by refetching rather than by showing an
 * error. A revision conflict means the client's view is stale, which is a
 * normal outcome of two seats sharing one page, not a failure.
 */
export const REFETCH_ON: readonly ErrorCode[] = Object.freeze([
  'GAME_REVISION_CONFLICT',
  'NOT_YOUR_TURN',
  'GAME_OVER',
]);
