import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { isPublicRoute } from '../../common/decorators/public.decorator';
import { UnauthenticatedError } from '../../common/errors/api-error';
import { asAppRequest, setRequestUser } from '../../common/http/request-context';
import { AccessTokenService } from '../access-token.service';
import { USER_REPOSITORY, type UserRepository } from '../ports/user-repository.port';
import { toAuthenticatedUser } from '../user.entity';

/**
 * The only `Authorization` header shape this API accepts.
 *
 * Exact, and exacting. `Bearer` (capitalised, as RFC 6750 writes it), one or
 * more spaces, then a token containing no whitespace and nothing after it. Every
 * near-miss is a 401:
 *
 *  - `eyJhbGciOi…` — a bare token with no scheme
 *  - `Basic dXNlcjpwYXNz` — a different scheme
 *  - `Bearer` — a scheme with no token
 *  - `Bearer a b` — two tokens, or a token with a space in it
 *
 * A lenient parser here is a real hazard rather than a stylistic one: splitting
 * on whitespace and taking the last field accepts `Basic x eyJ…`, and trimming
 * a bare value accepts a token presented with no scheme at all. Both make the
 * header's meaning depend on the parser rather than on the standard.
 */
/**
 * Case-insensitive on the scheme, per RFC 7235 §2.1 ("the scheme name is
 * case-insensitive"). Rejecting `bearer eyJ…` would turn a conforming client
 * into a 401 — that is an interoperability bug, not a defence. Strictness here
 * belongs in the shape of the header, not in its capitalisation.
 */
export const BEARER_PATTERN = /^Bearer +([^\s]+)$/i;

/** The token from a well-formed header, or `null`. Does no I/O and cannot throw. */
export function bearerTokenFrom(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }

  return BEARER_PATTERN.exec(header)?.[1] ?? null;
}

/**
 * Default-deny authentication, mounted globally as an `APP_GUARD` by
 * `app.module.ts`.
 *
 * Every route in every module runs through this unless it carries `@Public()`,
 * so a controller whose decorator was forgotten fails closed. The previous
 * generation of this project opted in per router and shipped five
 * unauthenticated gameplay endpoints while its README claimed otherwise.
 *
 * Three properties are deliberate, and each has a test:
 *
 *  - **It throws, never `return false`.** A guard returning `false` produces a
 *    bare `ForbiddenException`, which reaches `DomainExceptionFilter` with a
 *    status but no contract code — and the filter deliberately refuses to invent
 *    one, rendering it as an opaque 500. `UnauthenticatedError` carries
 *    `UNAUTHENTICATED`, which the contract maps to 401.
 *  - **A malformed header costs nothing.** The shape check runs before token
 *    verification and before the database lookup, so a flood of junk
 *    `Authorization` headers is rejected without a signature check or a query.
 *  - **Revocation is checked against stored state.** The user is reloaded on
 *    every request and their current `tokenVersion` compared with the token's
 *    claim. A stateless JWT alone would make logout cosmetic: the token would
 *    keep verifying until it expired. This is the read that makes it real, and
 *    it is the reason the guard touches the repository at all.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokenService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) {
      return true;
    }

    const request = asAppRequest(context.switchToHttp().getRequest());
    const token = bearerTokenFrom(request.headers.authorization);

    // Before `tokens.verify` and before `users.findById`: no signature check, no
    // query. Ordering, not politeness.
    if (token === null) {
      throw new UnauthenticatedError();
    }

    const claims = await this.tokens.verify(token);
    const user = await this.users.findById(claims.sub);

    // Same error for "no such user" and "revoked": a deleted account and a
    // logged-out one are both simply not authenticated, and distinguishing them
    // in the response would be a membership test. A missing user yields
    // `undefined`, which never equals a version number, so the two collapse into
    // one comparison without either becoming reachable through the other.
    if (user?.tokenVersion !== claims.tokenVersion) {
      throw new UnauthenticatedError();
    }

    // The only channel `CurrentUser()` reads. Symbol-keyed, so nothing arriving
    // over the wire can pre-seed it — see `request-context.ts`.
    setRequestUser(request, toAuthenticatedUser(user));

    return true;
  }
}
