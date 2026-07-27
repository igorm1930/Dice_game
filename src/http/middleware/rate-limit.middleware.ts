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
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: env.RATE_LIMIT_MAX,
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
