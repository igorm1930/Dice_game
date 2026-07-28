import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { UnauthenticatedError, type User } from '../../core/domain/user';
import type { AuthService } from '../../core/services/auth.service';

const BEARER = /^Bearer +(?<token>[^\s]+)$/;

/**
 * Resolves the `Authorization: Bearer <token>` header to a player.
 *
 * Every protected route mounts this, and controllers read `req.user` — never a
 * user id from the body or the query string. That is the whole point: identity
 * comes from a credential the server issued, so "act as the other player" is
 * not a request a client can express, let alone one it can win.
 *
 * The header is never logged and never echoed; failures say only that the
 * credential is unusable.
 */
export function authenticate(authService: AuthService): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.get('authorization');

    if (!header) {
      next(new UnauthenticatedError('no Authorization header was supplied'));
      return;
    }

    const token = BEARER.exec(header)?.groups?.token;
    if (token === undefined) {
      next(new UnauthenticatedError("the Authorization header must be 'Bearer <token>'"));
      return;
    }

    authService
      .authenticate(token)
      .then((user) => {
        req.user = user;
        req.authToken = token;
        next();
      })
      .catch(next);
  };
}

/**
 * Type-safe accessor for the authenticated player.
 *
 * Throws rather than returning `undefined` so a route that forgot the
 * middleware fails loudly in development instead of silently treating every
 * caller as anonymous.
 */
export function currentUser(req: Request): User {
  if (!req.user) {
    throw new Error(
      'No authenticated user on this request. Mount authenticate() before this handler.',
    );
  }
  return req.user;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    authToken?: string;
  }
}
