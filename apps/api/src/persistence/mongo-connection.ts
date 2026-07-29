import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { type Connection, ConnectionStates, type ConnectOptions, Mongoose } from 'mongoose';

import { APP_CONFIG } from '../config/config.module';
import { type AppConfig } from '../config/env.schema';

/**
 * How long the driver may hunt for a reachable server before giving up.
 *
 * The default is 30 seconds, which turns "the database is not there" into a
 * boot that appears to hang and a request that appears to stall. Five seconds
 * is long enough to ride out an election and short enough that a readiness
 * probe polled every few seconds gets an answer rather than a queue.
 */
export const SERVER_SELECTION_TIMEOUT_MS = 5000;

/**
 * The connection failed to open. Carries the database *name* and never the URI.
 *
 * `MONGODB_URI` may hold a password in any environment that has one, and a boot
 * failure is precisely the moment a connection string ends up in a crash log,
 * an alerting webhook and a screenshot. `EnvValidationError` makes the same
 * choice for the same reason: paths and reasons, never values.
 */
export class MongoConnectionError extends Error {
  constructor(dbName: string | undefined, cause: unknown) {
    // Naming where the database came from, not just what it was called. The
    // two most confusing failures here are "connected to the wrong database"
    // and "could not connect at all", and they read identically otherwise.
    const target =
      dbName === undefined
        ? 'the database named in MONGODB_URI'
        : `"${dbName}" (from MONGODB_DB_NAME)`;

    super(
      `Refusing to start: could not connect to MongoDB ${target}. Check MONGODB_URI and that the server is reachable.`,
      { cause },
    );
    this.name = 'MongoConnectionError';
  }
}

/**
 * The one MongoDB connection this process owns, and its lifecycle.
 *
 * Three properties are deliberate:
 *
 *  - **The URI comes from validated configuration, never from `process.env`.**
 *    `AppConfig` is parsed once at boot and frozen; this reads `config.mongo`
 *    and nothing else. A driver that read the environment itself would be a
 *    second, unvalidated configuration boundary.
 *  - **Failure is loud, and it is loud at boot.** The connection is opened in
 *    `onModuleInit`, so `NestFactory.create(...)`/`app.init()` rejects and the
 *    process exits rather than accepting traffic and failing at the first
 *    request. `serverSelectionTimeoutMS` bounds how long that takes.
 *  - **`sanitizeFilter` is on for every query on this connection.** It wraps any
 *    nested object whose keys start with `$` in an `$eq`, so a query selector
 *    that reached a filter is compared as a value instead of executed as an
 *    operator. It is a backstop, not the defence — every filter in this codebase
 *    is built from explicitly typed fields, behind the contract's Zod schemas —
 *    but the failure it covers (one hand-built filter, one unvalidated field) is
 *    the one that is easy to introduce and invisible in review.
 *
 * The option is set on a **private `Mongoose` instance** rather than through
 * `mongoose.set(...)` or the connect options. Two reasons, and the second is not
 * a preference:
 *
 *  - `mongoose.set('sanitizeFilter', true)` mutates process-global state, which
 *    a library this application merely depends on has no business doing.
 *  - passing it to `openUri` does **not** work. Mongoose files connect-time
 *    options on `connection.config`, while `Query` reads it from
 *    `model.db.options` and then `model.base.options` — so the connect option is
 *    silently inert, and the whole defence would read as present while being
 *    absent. `auth.integration.spec.ts` fails if this line is removed; that is
 *    how the discrepancy was found.
 *
 * The connection is created **unopened**: `createConnection()` with no URI hands
 * back a `Connection` that models can be compiled onto but that has not dialled
 * anything. That is what lets the repositories register their models during
 * container construction, before this hook runs, and what lets a test that only
 * cares about routing stand in an offline double without also standing in a
 * model registry.
 */
@Injectable()
export class MongoConnection implements OnModuleInit, OnApplicationShutdown {
  /** This application's own Mongoose instance. Declared first: `connection` uses it. */
  private readonly mongoose = new Mongoose({ sanitizeFilter: true });

  /** The live connection. Repositories compile their models onto it. */
  readonly connection: Connection = this.mongoose.createConnection();

  private readonly logger = new Logger(MongoConnection.name);

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onModuleInit(): Promise<void> {
    const { uri, dbName } = this.config.mongo;

    const options: ConnectOptions = {
      // Passed ONLY when explicitly configured. Mongoose's `dbName` overrides
      // the database in the URI, so passing a defaulted value here would make
      // the URI's own database silently irrelevant.
      ...(dbName === undefined ? {} : { dbName }),
      serverSelectionTimeoutMS: SERVER_SELECTION_TIMEOUT_MS,
      /**
       * Indexes are built below, explicitly and awaited. Mongoose's automatic
       * build is fire-and-forget: it starts when a model is compiled and nobody
       * waits for it, so the unique index on `email` would not reliably exist
       * for the first registrations after a cold start — and a unique index that
       * is not there yet is not a constraint, it is a comment.
       */
      autoIndex: false,
    };

    try {
      await this.connection.openUri(uri, options);
    } catch (cause) {
      throw new MongoConnectionError(dbName, cause);
    }

    await this.createIndexes();

    // Report what was actually connected to, read back off the connection —
    // not what was configured. Those were the same thing right up until they
    // were not, and the log said "dice-game" either way.
    this.logger.log(`Connected to MongoDB database "${this.connection.name}".`);
  }

  /**
   * Closes the connection during the shutdown drain.
   *
   * `false` rather than the default: in-flight operations are allowed to finish,
   * because `main.ts` has already stopped accepting new work and is waiting on
   * exactly these. Forcing here would abort a write that a client is still
   * holding a connection open for.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.connection.close(false);
  }

  /**
   * Round-trips a `ping` to the server. Never throws.
   *
   * This is what makes `/api/health/ready` able to report a dependency failure
   * at all. `readyState` alone is not enough — it says what the driver believes,
   * which is stale in exactly the window that matters — so the check is an
   * actual command, bounded by `serverSelectionTimeoutMS`.
   */
  async ping(): Promise<boolean> {
    if (this.connection.readyState !== ConnectionStates.connected) {
      return false;
    }

    const db = this.connection.db;

    if (db === undefined) {
      return false;
    }

    try {
      await db.admin().command({ ping: 1 });

      return true;
    } catch {
      // A probe answers, always. Reporting `down` lets the orchestrator take
      // this instance out of rotation; throwing would make it a 500 and, to
      // most orchestrators, an indistinguishable timeout.
      return false;
    }
  }

  /**
   * Builds every registered model's indexes, and waits.
   *
   * Called once, at boot, after the connection is open and before the
   * application serves anything. Every provider in the container has already
   * been constructed by the time lifecycle hooks run, so every model is
   * registered by now.
   */
  private async createIndexes(): Promise<void> {
    await Promise.all(Object.values(this.connection.models).map((model) => model.createIndexes()));
  }
}
