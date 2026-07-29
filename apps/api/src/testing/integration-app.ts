import { API_PREFIX } from '@dice-game/contracts';
import { type INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { errorEnvelopeFallback } from '../common/http/error-fallback';
import { loadAppConfig, resetAppConfigCache } from '../config/env.schema';
import { type DeterministicDiceGenerator } from '../games/adapters/deterministic-dice.generator';
import { DICE_GENERATOR } from '../games/ports/dice-generator.port';
import { MongoConnection } from '../persistence/mongo-connection';

/**
 * The harness the integration suite boots the real API on.
 *
 * "Integration" here means what it says: the whole Nest container, the real
 * guards, the real Argon2 hasher, the real envelope interceptor and exception
 * filter, and a **real MongoDB** — the one `docker compose up -d` starts. There
 * are no fakes below the HTTP boundary. Anything that passes here passed against
 * the storage engine that will run in production, which is the entire point: the
 * compare-and-set, the unique index and the operator-injection defence are all
 * properties of the *server*, and a `Map` cannot be wrong about them in the same
 * ways.
 */

/**
 * A separate database from the one `pnpm dev` and `pnpm db:seed` use.
 *
 * `MONGODB_DB_NAME` is passed to the driver as `dbName`, which overrides
 * whatever database the URI names, so a contributor running this suite against
 * their local server does not wake up to an empty dice-game database.
 */
export const INTEGRATION_DB_NAME = 'dice-game-integration-test';

/**
 * Environment for every integration app, applied before the config cache is
 * dropped.
 *
 * `NODE_ENV=test` is load-bearing twice over: it selects the deterministic dice
 * (see `dice-generator.provider.ts`), which is what lets a test assert a double
 * six rather than wait for one, and it keeps the production-only refusals in
 * `env.schema.ts` out of the way.
 */
function applyIntegrationEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI ??= 'mongodb://localhost:27017/dice-game';
  process.env.MONGODB_DB_NAME = INTEGRATION_DB_NAME;

  /**
   * The Argon2 floor the schema allows. The hasher is still the real one — this
   * suite exercises registration and login dozens of times, and the production
   * cost profile would spend most of the run deliberately burning CPU to prove
   * something `auth.service.test.ts` already proves.
   */
  process.env.ARGON2_MEMORY_KIB = '8192';
  process.env.ARGON2_TIME_COST = '1';

  /**
   * Rate limiting is not what these tests are about, and the credential budget
   * (20 per 15 minutes) is smaller than one file's worth of registrations. Its
   * behaviour is asserted by `app.routes.test.ts` at the level that matters:
   * which routes are on which tier.
   */
  process.env.RATE_LIMIT_MAX = '100000';
  process.env.AUTH_RATE_LIMIT_MAX = '100000';
}

/** A booted API, plus the handles a test needs to drive and inspect it. */
export interface IntegrationApp {
  readonly app: INestApplication;
  /** Supertest bound to this instance's server. */
  readonly http: ReturnType<typeof request>;
  /** This instance's connection — a *different* one per app, deliberately. */
  readonly mongo: MongoConnection;
  /** The scripted dice this instance rolls. */
  readonly dice: DeterministicDiceGenerator;
  close(): Promise<void>;
}

/**
 * Boots one API instance against the real database.
 *
 * Every call produces a **fresh container and a fresh connection**, which is
 * what makes "does this survive a restart?" and "do two instances agree?"
 * answerable at all: the second instance shares nothing with the first except
 * MongoDB, so anything it can still see is genuinely persisted.
 *
 * The pipeline mirrors `main.ts` where it affects behaviour — global prefix and
 * the trailing error-envelope fallback — and skips what only matters to a real
 * deployment (helmet, CORS, the SIGTERM drain).
 */
export async function createIntegrationApp(): Promise<IntegrationApp> {
  applyIntegrationEnv();
  resetAppConfigCache();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.setGlobalPrefix(API_PREFIX);

  // Routes first, then the fallback, exactly as `main.ts` orders them: appended
  // before `init` it would sit in front of every handler and answer everything.
  await app.init();
  app.getHttpAdapter().getInstance().use(errorEnvelopeFallback());

  const dice = app.get<DeterministicDiceGenerator>(DICE_GENERATOR);

  return {
    app,
    http: request(app.getHttpServer()),
    mongo: app.get(MongoConnection),
    dice,
    close: () => app.close(),
  };
}

/**
 * An **unopened** connection, configured exactly as the application's is.
 *
 * For the repository suites, which exercise a port directly rather than over
 * HTTP and have no reason to boot a container. Call `onModuleInit()` *after*
 * constructing the repositories that use it: that is the order Nest itself uses
 * — every provider is instantiated, and only then do the lifecycle hooks run —
 * and it is what makes the index build in `onModuleInit` cover the models the
 * repositories registered.
 */
export function newTestConnection(): MongoConnection {
  applyIntegrationEnv();
  resetAppConfigCache();

  return new MongoConnection(loadAppConfig());
}

/**
 * Empties every collection, leaving the indexes in place.
 *
 * Not `dropDatabase()`: that would take the unique index on `email` with it, and
 * the indexes are built once at boot. A suite that silently ran without them
 * would still pass the duplicate-registration test — through the second
 * registration's insert succeeding and the assertion never being reached — which
 * is precisely the failure this suite exists to catch.
 */
export async function clearDatabase(mongo: MongoConnection): Promise<void> {
  const db = mongo.connection.db;

  if (db === undefined) {
    throw new Error('Cannot clear the integration database: the connection is not open.');
  }

  const collections = await db.collections();

  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}
