import { type CustomDecorator, SetMetadata } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import {
  CREDENTIALS_RATE_LIMIT,
  GENERAL_RATE_LIMIT,
  RATE_LIMIT_TIER_KEY,
} from '../../config/rate-limit.config';

/**
 * Charges a route to the credential budget instead of the gameplay budget.
 *
 * Put it on register, login, and anything else that verifies or issues a
 * credential. The budget comes from `AUTH_RATE_LIMIT_WINDOW_MS` /
 * `AUTH_RATE_LIMIT_MAX`, which are an order of magnitude tighter than the
 * gameplay ones — a limit sized for a player clicking Roll is a limit sized for
 * thousands of password guesses an hour.
 *
 * ```ts
 * @Public()
 * @CredentialsRateLimit()
 * @Post('login')
 * login(...) { ... }
 * ```
 */
export const CredentialsRateLimit = (): CustomDecorator =>
  SetMetadata(RATE_LIMIT_TIER_KEY, CREDENTIALS_RATE_LIMIT);

/**
 * Exempts a route from rate limiting entirely.
 *
 * Reserved for the health probes. An orchestrator polls `/api/health/ready`
 * every few seconds from a small set of addresses; throttling it means the
 * platform eventually reads a 429 as "unhealthy" and restarts a process that
 * was fine.
 *
 * `SkipThrottle()` with no argument skips only a throttler named `default`, and
 * this application names its throttlers, so both are listed explicitly.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle({ [GENERAL_RATE_LIMIT]: true, [CREDENTIALS_RATE_LIMIT]: true });
