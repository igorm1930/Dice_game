import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';

import { parseCorsOrigin, type Env } from '../config/env';
import type { GameController } from './controllers/game.controller';
import type { HealthController } from './controllers/health.controller';
import type { PigGameController } from './controllers/pig-game.controller';
import { correlationIdMiddleware } from './middleware/correlation-id.middleware';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { httpLogger } from './middleware/http-logger.middleware';
import { createRateLimiter } from './middleware/rate-limit.middleware';
import { createGameRouter } from './routes/game.routes';
import { createHealthRouter } from './routes/health.routes';
import { createPigGameRouter } from './routes/pig-game.routes';

export interface AppDependencies {
  readonly env: Env;
  readonly logger: Logger;
  readonly gameController: GameController;
  readonly pigGameController: PigGameController;
  readonly healthController: HealthController;
}

export const API_PREFIX = '/api/v1';

/**
 * Assembles the Express application.
 *
 * Returns the app without listening on a port. That separation is what lets the
 * integration suite drive the full middleware stack through supertest with no
 * sockets, no port conflicts, and no cleanup.
 *
 * Middleware order is load-bearing and reads top to bottom:
 *   1. correlation id  — so every later log line is traceable
 *   2. security headers, CORS
 *   3. access logging
 *   4. body parsing (bounded)
 *   5. probes         — before the rate limiter, never throttled
 *   6. rate limiting  — API surface only
 *   7. routes
 *   8. 404, then the terminal error handler
 */
export function createApp(deps: AppDependencies): Express {
  const { env, logger, gameController, pigGameController, healthController } = deps;
  const app = express();

  // Never advertise the framework.
  app.disable('x-powered-by');

  // Trust exactly as many proxy hops as are actually in front of us. Blanket
  // `trust proxy: true` lets a client spoof X-Forwarded-For and evade the rate
  // limiter by forging a new source IP per request.
  app.set('trust proxy', env.TRUST_PROXY_HOPS);

  app.use(correlationIdMiddleware());
  app.use(helmet());
  app.use(
    cors({
      origin: parseCorsOrigin(env.CORS_ORIGIN),
      methods: ['GET', 'POST'],
      exposedHeaders: ['x-request-id'],
      maxAge: 600,
    }),
  );
  app.use(httpLogger(logger));

  app.use(express.json({ limit: env.BODY_LIMIT }));

  app.use(createHealthRouter(healthController));

  app.use(API_PREFIX, createRateLimiter(env));
  app.use(API_PREFIX, createGameRouter(gameController));
  app.use(API_PREFIX, createPigGameRouter(pigGameController));

  // Static frontend (the Pig Game client), served only when a build exists.
  // Mounted after the API so no static file can ever shadow an endpoint, and
  // gated on existence so API-only deployments and the test suite behave
  // exactly as before. Hashed assets cache aggressively; index.html never
  // caches, so a redeploy is picked up on the next page load.
  const clientDir = resolve('client/dist');
  if (existsSync(clientDir)) {
    app.use(
      express.static(clientDir, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));

  return app;
}
