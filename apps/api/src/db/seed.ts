import 'reflect-metadata';

import { registerRequestSchema } from '@dice-game/contracts';
import { ConsoleLogger, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { EmailTakenError } from '../auth/auth.errors';
import { AuthModule } from '../auth/auth.module';
import { PASSWORD_HASHER, type PasswordHasher } from '../auth/ports/password-hasher.port';
import { USER_REPOSITORY, type UserRepository } from '../auth/ports/user-repository.port';
// Importing this module has a side effect the script depends on: `forRoot`
// merges `.env` (and the repository-root `.env`) into `process.env` *while this
// file's imports are evaluated*, which is what makes `loadAppConfig()` below see
// a developer's local settings before any Nest container exists — and therefore
// what lets the refusals below run before a connection is opened.
import { AppConfigModule } from '../config/config.module';
import { loadAppConfig } from '../config/env.schema';
import { PersistenceModule } from '../persistence/persistence.module';
import { DEMO_USERS, type DemoUser, refuseToSeed } from './demo-seed';

/**
 * `pnpm db:seed` — two demo players, so a reviewer can log in and play.
 *
 * The refusals and the accounts themselves live in `demo-seed.ts`, where a test
 * can reach them without booting anything. This file is the executable: check,
 * connect, write, report.
 *
 * An address that already has an account is skipped rather than overwritten, so
 * the script is safe to re-run and will never reset a password on an account
 * somebody has been using.
 *
 * Credentials are printed at the end. They are deliberately not secret — they
 * exist so a reviewer can play immediately, and a demo login nobody can find is
 * a demo login nobody uses. That is precisely why the refusals exist.
 */

/**
 * The application, minus the HTTP surface.
 *
 * It reuses the production wiring rather than reaching for the driver directly:
 * the same `PersistenceModule` opens the connection and builds the indexes, and
 * the same `USER_REPOSITORY` and `PASSWORD_HASHER` bindings do the work. A seed
 * script that hand-rolled its own insert would be a second implementation of
 * registration, and the first thing it would drift on is the Argon2 cost.
 */
@Module({
  imports: [AppConfigModule, PersistenceModule, AuthModule],
})
class SeedModule {}

/** What happened to one demo account. */
type SeedOutcome = 'created' | 'already-present';

async function seedOne(
  demo: DemoUser,
  users: UserRepository,
  hasher: PasswordHasher,
): Promise<SeedOutcome> {
  // Validated against the same schema `POST /api/auth/register` uses, so a demo
  // password that is too short or a display name with an illegal character is a
  // failure here rather than a puzzle at the login screen.
  const request = registerRequestSchema.parse(demo);

  try {
    await users.create({
      email: request.email,
      displayName: request.displayName,
      passwordHash: await hasher.hash(request.password),
    });

    return 'created';
  } catch (error) {
    if (error instanceof EmailTakenError) {
      return 'already-present';
    }

    throw error;
  }
}

async function main(): Promise<number> {
  const logger = new Logger('Seed');
  const config = loadAppConfig();
  const refusal = refuseToSeed(config);

  if (refusal !== null) {
    logger.error(refusal);

    return 1;
  }

  const app = await NestFactory.createApplicationContext(SeedModule, {
    logger: new ConsoleLogger({
      prefix: config.observability.serviceName,
      logLevels: ['fatal', 'error', 'warn', 'log'],
      json: false,
      colors: true,
    }),
    abortOnError: false,
  });

  try {
    const users = app.get<UserRepository>(USER_REPOSITORY);
    const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);

    for (const demo of DEMO_USERS) {
      const outcome = await seedOne(demo, users, hasher);

      logger.log(
        outcome === 'created'
          ? `Created ${demo.email} (${demo.displayName}).`
          : `${demo.email} already exists; leaving it untouched.`,
      );
    }

    logger.log('Demo credentials — not secrets, and not valid anywhere but a local database:');

    for (const demo of DEMO_USERS) {
      logger.log(`  ${demo.displayName}: ${demo.email} / ${demo.password}`);
    }
  } finally {
    // Closes the Mongo connection through the same shutdown hook the API uses,
    // so the process exits instead of sitting on an open socket.
    await app.close();
  }

  return 0;
}

/**
 * `process.exitCode` rather than `process.exit()`: the latter tears the process
 * down immediately, which would truncate the very output this script exists to
 * produce.
 */
void main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    new Logger('Seed').error(error);
    process.exitCode = 1;
  },
);
