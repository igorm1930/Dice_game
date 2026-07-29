import 'reflect-metadata';

import { setTimeout as delay } from 'node:timers/promises';

import { API_PREFIX } from '@dice-game/contracts';
import { ConsoleLogger, type INestApplication, Logger, type LogLevel } from '@nestjs/common';
import { type CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import { type NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { mountApiDocs } from './docs';
import { errorEnvelopeFallback } from './common/http/error-fallback';
import { DrainState } from './common/lifecycle/drain-state';
import { APP_CONFIG } from './config/config.module';
import { type AppConfig, type LogLevel as ConfiguredLogLevel } from './config/env.schema';

/**
 * How long readiness is allowed to report `not_ready` before the listener
 * closes, so a load balancer polling every second or two actually observes it.
 * Taken out of the overall `SHUTDOWN_TIMEOUT_MS` budget, never added to it.
 */
const PROBE_GRACE_MS = 2000;

/** How long a preflight response may be cached, in seconds. */
const CORS_MAX_AGE_SECONDS = 600;

/** Maps the configured level onto the levels Nest's logger understands. */
function nestLogLevels(level: ConfiguredLogLevel): LogLevel[] {
  const ladder: readonly LogLevel[] = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'];
  const depth: Readonly<Record<ConfiguredLogLevel, number>> = {
    fatal: 1,
    error: 2,
    warn: 3,
    info: 4,
    debug: 5,
    trace: 6,
  };

  return [...ladder.slice(0, depth[level])];
}

/**
 * CORS, restricted to the configured origins.
 *
 * `*` is accepted only because `NODE_ENV=production` with a wildcard origin
 * fails configuration validation before this code runs — see `env.schema.ts`.
 * Credentials are off: the access token lives in `sessionStorage` and travels in
 * an `Authorization` header, because two seats share one browser origin on the
 * same page and a cookie session cannot represent both at once.
 */
function corsOptions(config: AppConfig): CorsOptions {
  const origins = config.http.corsOrigins;

  return {
    origin: origins.includes('*') ? '*' : [...origins],
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials: false,
    maxAge: CORS_MAX_AGE_SECONDS,
  };
}

/**
 * The ordered SIGTERM drain.
 *
 * 1. Readiness starts failing. The balancer stops sending new work.
 * 2. A short grace period, so it has a chance to notice.
 * 3. The listener closes and in-flight requests finish, bounded by whatever is
 *    left of `SHUTDOWN_TIMEOUT_MS`.
 *
 * The order is the point. Closing the listener first drops requests that were
 * already accepted, and leaves the balancer routing to a dead instance until its
 * next poll. Fly's `kill_timeout` must exceed `SHUTDOWN_TIMEOUT_MS` or the
 * process is SIGKILLed mid-drain.
 */
async function drain(app: INestApplication, config: AppConfig, logger: Logger): Promise<never> {
  const budgetMs = config.lifecycle.shutdownTimeoutMs;

  logger.log(`Draining: failing readiness, then closing within ${String(budgetMs)}ms`);
  app.get(DrainState).beginDrain();

  const graceMs = Math.min(PROBE_GRACE_MS, Math.floor(budgetMs / 2));
  await delay(graceMs, undefined, { ref: false });

  const outcome = await Promise.race([
    app.close().then(() => 'closed' as const),
    delay(Math.max(budgetMs - graceMs, 0), 'timed-out' as const, { ref: false }),
  ]);

  if (outcome === 'closed') {
    logger.log('Drain complete.');
    process.exit(0);
  }

  logger.error('Drain exceeded SHUTDOWN_TIMEOUT_MS; exiting with in-flight requests unfinished.');
  process.exit(1);
}

function installSignalHandlers(app: INestApplication, config: AppConfig, logger: Logger): void {
  let draining = false;

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      if (draining) {
        // A second signal during a drain is an operator losing patience, not a
        // reason to start a second, overlapping shutdown.
        logger.warn(`Received ${signal} while already draining; ignoring.`);

        return;
      }

      draining = true;
      logger.log(`Received ${signal}.`);
      void drain(app, config, logger);
    });
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Registered explicitly below so the limit comes from validated config.
    bodyParser: false,
    bufferLogs: true,
  });

  const config = app.get<AppConfig>(APP_CONFIG);
  const { observability } = config;

  /**
   * Interactive docs are a development and review convenience. In production
   * they would be seven unauthenticated, unthrottled paths that `PUBLIC_ROUTES`
   * does not name — see `mountApiDocs`.
   */
  const docsEnabled = !config.isProduction;

  app.useLogger(
    new ConsoleLogger({
      prefix: observability.serviceName,
      logLevels: nestLogLevels(observability.logLevel),
      // Collectors want NDJSON; humans want colour. Production gets the former.
      json: !observability.logPretty,
      colors: observability.logPretty,
    }),
  );

  const logger = new Logger('Bootstrap');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Swagger UI bootstraps itself from an inline script, so serving it
          // costs an `unsafe-inline` relaxation. Production does not serve it,
          // and therefore does not pay for it — the API is JSON only there, and
          // a policy that permits inline script for no reason is a policy that
          // will be inherited by whatever gets added next.
          scriptSrc: docsEnabled ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          styleSrc: docsEnabled ? ["'self'", "'unsafe-inline'"] : ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  app.useBodyParser('json', { limit: config.http.bodyLimit });

  /**
   * The exact hop count, never `true`.
   *
   * `true` makes Express believe the left-most `X-Forwarded-For` entry, which is
   * whatever the client wrote there — so a client mints itself a fresh
   * rate-limit key on every request simply by incrementing a header. Too low and
   * everyone keys on the load balancer's address and shares one budget. The
   * number has to match the real topology: 0 locally, 1 behind Fly's proxy.
   */
  app.set('trust proxy', config.http.trustProxyHops);

  app.setGlobalPrefix(API_PREFIX);
  app.enableCors(corsOptions(config));

  mountApiDocs(app, config);

  // Routes must exist before the fallback error handler is appended, or it would
  // sit in front of them and never see anything.
  await app.init();
  app.getHttpAdapter().getInstance().use(errorEnvelopeFallback());

  installSignalHandlers(app, config, logger);

  await app.listen(config.port, config.host);

  logger.log(
    `${observability.serviceName} listening on http://${config.host}:${String(config.port)}${API_PREFIX} (${config.nodeEnv})`,
  );
}

void bootstrap();
