import { type CustomDecorator, SetMetadata } from '@nestjs/common';
import { type ExecutionContext } from '@nestjs/common';
import { type Reflector } from '@nestjs/core';

/**
 * Marks a route as reachable without a token.
 *
 * The API mounts a global `APP_GUARD`, so **every** route is protected unless it
 * carries this decorator. That direction is the whole point: a controller whose
 * decorator was forgotten fails closed. The previous generation opted in per
 * router and shipped five unauthenticated gameplay endpoints while its README
 * claimed the opposite.
 *
 * `PUBLIC_ROUTES` in `@dice-game/contracts` is the allow-list this must agree
 * with — register, login, and the two health probes, and nothing else.
 */
export const IS_PUBLIC_KEY = 'dice-game:is-public';

export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Whether the handler (or its controller) opted out of authentication.
 *
 * Exported so the authentication guard has one implementation to call rather
 * than re-deriving the reflector lookup, and so a test can assert the guard and
 * the decorator agree.
 */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true
  );
}
