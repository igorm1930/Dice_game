import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type ThrottlerModuleOptions } from '@nestjs/throttler';

import { type AppConfig } from './env.schema';

/**
 * Two rate-limit tiers, because one budget cannot serve two purposes.
 *
 * A limit sized for gameplay — a player clicking Roll — is a limit sized for
 * thousands of password guesses an hour. So credential endpoints get their own,
 * far smaller budget, and every route belongs to exactly one tier.
 *
 * The tiers are implemented as two *named* throttlers whose `skipIf` reads a
 * route's declared tier. A route with no declaration is charged to the general
 * budget, which is the safe default: forgetting the decorator on a new gameplay
 * route rate-limits it normally, and the credential budget can only ever be
 * *opted into*, never accidentally applied to gameplay.
 */
export const RATE_LIMIT_TIERS = ['general', 'credentials'] as const;

export type RateLimitTier = (typeof RATE_LIMIT_TIERS)[number];

/** The budget every route is charged to unless it says otherwise. */
export const GENERAL_RATE_LIMIT: RateLimitTier = 'general';

/**
 * The much smaller budget for anything that verifies or issues a credential:
 * register, login, and any future password change. Referenced by the auth
 * module through the `CredentialsRateLimit()` decorator.
 */
export const CREDENTIALS_RATE_LIMIT: RateLimitTier = 'credentials';

/** Metadata key carrying a route's tier. Set by `CredentialsRateLimit()`. */
export const RATE_LIMIT_TIER_KEY = 'dice-game:rate-limit-tier';

/**
 * A standalone `Reflector` — it is a thin wrapper over `Reflect.getMetadata`
 * with no injected state, and `skipIf` is a plain callback the throttler invokes
 * outside the injector.
 */
const reflector = new Reflector();

/** The tier a route declared, defaulting to the general budget. */
export function rateLimitTierOf(context: ExecutionContext): RateLimitTier {
  const declared = reflector.getAllAndOverride<RateLimitTier | undefined>(RATE_LIMIT_TIER_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);

  return declared ?? GENERAL_RATE_LIMIT;
}

/**
 * The throttler configuration, derived from validated config.
 *
 * `ttl` is milliseconds in `@nestjs/throttler` v6, which is why the environment
 * variables are named `*_WINDOW_MS` and passed through untouched.
 */
export function throttlerOptionsFor(config: AppConfig): ThrottlerModuleOptions {
  return {
    errorMessage: 'Too many requests. Wait a moment and try again.',
    throttlers: [
      {
        name: GENERAL_RATE_LIMIT,
        ttl: config.rateLimit.general.windowMs,
        limit: config.rateLimit.general.limit,
        skipIf: (context) => rateLimitTierOf(context) !== GENERAL_RATE_LIMIT,
      },
      {
        name: CREDENTIALS_RATE_LIMIT,
        ttl: config.rateLimit.credentials.windowMs,
        limit: config.rateLimit.credentials.limit,
        skipIf: (context) => rateLimitTierOf(context) !== CREDENTIALS_RATE_LIMIT,
      },
    ],
  };
}
