import { randomUUID } from 'node:crypto';

import { type AuthenticatedUser } from '@dice-game/contracts';
import { type Request, type Response } from 'express';

/**
 * What the delivery layer attaches to a request, and the only sanctioned way to
 * read it back.
 *
 * Both values are keyed by symbols rather than by plain properties such as
 * `req.user`. Two reasons, and the second is the one that matters:
 *
 *  1. Nothing that arrives over the wire — a header, a query string, a body —
 *     can produce a symbol-keyed property, so an attacker cannot pre-seed the
 *     request object with an identity.
 *  2. The accessors below are total: `requireRequestUser` throws rather than
 *     returning `undefined`. A handler that silently receives an undefined
 *     identity and treats it as "some user" is the failure mode this design
 *     exists to remove.
 */

/** The verified caller, as every layer above the guard sees them. */
export type RequestUser = AuthenticatedUser;

const REQUEST_ID = Symbol.for('dice-game.request-id');
const REQUEST_USER = Symbol.for('dice-game.request-user');

interface RequestState {
  [REQUEST_ID]?: string;
  [REQUEST_USER]?: RequestUser;
}

/** An Express request carrying whatever this application has attached to it. */
export type AppRequest = Request & RequestState;

/** Raised when a handler asks for an identity on a request that has none. */
export class MissingRequestUserError extends Error {
  constructor() {
    super(
      'No authenticated user on this request. CurrentUser() was used on a route the authentication guard did not protect — check for a stray Public() or a guard that resolved without attaching an identity.',
    );
    this.name = 'MissingRequestUserError';
  }
}

/** Records the verified caller. Called by the authentication guard, once. */
export function setRequestUser(request: AppRequest, user: RequestUser): void {
  request[REQUEST_USER] = user;
}

/**
 * The verified caller, or `null` when the guard did not run.
 *
 * Prefer {@link requireRequestUser} in handlers; this exists for the few places
 * that legitimately ask "is anyone authenticated?", such as logging.
 */
export function getRequestUser(request: AppRequest): RequestUser | null {
  return request[REQUEST_USER] ?? null;
}

/**
 * The verified caller.
 *
 * @throws {MissingRequestUserError} if no guard attached one. Never returns
 * `undefined` — see the note at the top of this file.
 */
export function requireRequestUser(request: AppRequest): RequestUser {
  const user = request[REQUEST_USER];

  if (user === undefined) {
    throw new MissingRequestUserError();
  }

  return user;
}

/** Records the correlation id for this request. Called by the middleware. */
export function setRequestId(request: AppRequest, requestId: string): void {
  request[REQUEST_ID] = requestId;
}

/**
 * The correlation id for this request, minting one if the middleware never ran.
 *
 * The envelope's `meta.requestId` is the value a user quotes in a bug report, so
 * it must always be present — including on a response produced by a failure so
 * early that no middleware executed.
 */
export function resolveRequestId(request: AppRequest): string {
  const existing = request[REQUEST_ID];

  if (existing !== undefined) {
    return existing;
  }

  const generated = randomUUID();
  request[REQUEST_ID] = generated;

  return generated;
}

/** Narrows an unknown Express-ish object to something the accessors accept. */
export function asAppRequest(request: unknown): AppRequest {
  return request as AppRequest;
}

/** Narrows an unknown Express-ish object to a response. */
export function asResponse(response: unknown): Response {
  return response as Response;
}
