import { randomBytes } from 'node:crypto';

import { Module } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions, type JwtSignOptions } from '@nestjs/jwt';

import { APP_CONFIG, AppConfigModule } from '../config/config.module';
import { type AppConfig } from '../config/env.schema';
import { AccessTokenService } from './access-token.service';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
import { InMemoryUserRepository } from './adapters/in-memory-user.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import { USER_REPOSITORY } from './ports/user-repository.port';

/**
 * The password the dummy digest is made from.
 *
 * Random per process and never stored, so no attacker can present it and the
 * digest cannot accidentally match a real login attempt. Hex, so its length is
 * comfortably inside `PASSWORD_MAX_LENGTH` — the bound exists because Argon2 is
 * deliberately slow and an unbounded input is a way to spend the server's CPU.
 */
function unguessablePassword(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Widens `JWT_EXPIRES_IN` to the type `@types/ms` insists on.
 *
 * `durationSchema` in `env.schema.ts` already constrains the value to exactly
 * the vocabulary `ms` understands — `15m`, `900s`, `7d`, or a bare number of
 * seconds — but it produces a plain `string`, while the signing options want a
 * template-literal union. The assertion restates a bound that has already been
 * enforced at boot; relaxing the environment schema to satisfy a type would be
 * the wrong way round, and so would accepting an arbitrary string here.
 */
function tokenLifetime(configured: string): NonNullable<JwtSignOptions['expiresIn']> {
  return configured as NonNullable<JwtSignOptions['expiresIn']>;
}

/**
 * Authentication: the ports, the Phase 3 adapters behind them, and the guard the
 * whole application is protected by.
 *
 * Both adapters are bound by token, so Phase 4 replaces
 * `InMemoryUserRepository` with a Mongoose one by editing exactly one line here.
 * Nothing that consumes `USER_REPOSITORY` — this module, the guard, the users
 * module — mentions either adapter.
 *
 * The exports are what make default-deny work. `app.module.ts` registers
 * `JwtAuthGuard` as a global `APP_GUARD`, and Nest builds that instance in the
 * root injector, so the guard's dependencies must be visible from there:
 * `AccessTokenService` and `USER_REPOSITORY` are exported for exactly that
 * reason, not for general use.
 */
@Module({
  imports: [
    AppConfigModule,
    JwtModule.registerAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      /**
       * One secret and one lifetime, both from validated configuration. The
       * environment schema already refuses to start a production process that
       * still carries the committed development secret, so there is nothing to
       * re-check here.
       */
      useFactory: (config: AppConfig): JwtModuleOptions => ({
        secret: config.auth.jwtSecret,
        signOptions: { expiresIn: tokenLifetime(config.auth.jwtExpiresIn) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    JwtAuthGuard,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: USER_REPOSITORY, useClass: InMemoryUserRepository },
    {
      /**
       * The throwaway digest the login path verifies against when no account
       * matches — the reason an unknown email costs what a wrong password costs.
       *
       * An **async factory**, deliberately. Nest awaits these while building the
       * container, so the Argon2 hash is computed once during boot and every
       * login, including the very first, finds it ready. Memoising it lazily on
       * first use would leave one measurably slower request — and that request
       * would be an unknown-email login, which is precisely the case this is
       * meant to make indistinguishable.
       */
      provide: DUMMY_PASSWORD_HASH,
      inject: [PASSWORD_HASHER],
      useFactory: (hasher: PasswordHasher): Promise<string> => hasher.hash(unguessablePassword()),
    },
  ],
  exports: [AuthService, AccessTokenService, JwtAuthGuard, USER_REPOSITORY, PASSWORD_HASHER],
})
export class AuthModule {}
