import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';

import type { Env } from '../../config/env';
import type { ErrorResponse } from '../dto/api-response';

/**
 * Fixed-window rate limiter.
 *
 * Backed by an in-process store, which — like the repository — is correct for a
 * single replica and would move to a shared store when scaling out (ADR-0002).
 * The limiter is applied to `/api` only: probes must never be throttled, or a
 * traffic spike causes the orchestrator to restart a service that is merely
 * busy, converting a load problem into an outage.
 */
export function createRateLimiter(env: Env): RateLimitRequestHandler {
  return build(env.RATE_LIMIT_WINDOW_MS, env.RATE_LIMIT_MAX);
}

/**
 * Tighter limiter for `/auth/register` and `/auth/login`.
 *
 * The general limit is sized for gameplay — a player rolling repeatedly is
 * normal traffic. Password guessing is not, and a limit generous enough for
 * dice is generous enough for a few thousand guesses an hour. Credential
 * endpoints therefore get their own, much smaller budget.
 */
export function createCredentialRateLimiter(env: Env): RateLimitRequestHandler {
  return build(env.AUTH_RATE_LIMIT_WINDOW_MS, env.AUTH_RATE_LIMIT_MAX);
}

function build(windowMs: number, limit: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Disabled: the library's default validation warns about trust-proxy
    // configuration, which we set explicitly and deliberately in app.ts.
    validate: { trustProxy: false, xForwardedForHeader: false },
    handler: (req, res) => {
      const payload: ErrorResponse = {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests. Retry after the window resets.',
        },
        meta: {
          requestId: req.requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
        },
      };

      res.status(429).json(payload);
    },
  });
}
