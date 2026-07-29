import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { DomainExceptionFilter } from './common/filters/domain-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { APP_CONFIG, AppConfigModule } from './config/config.module';
import { type AppConfig } from './config/env.schema';
import { throttlerOptionsFor } from './config/rate-limit.config';
import { GamesModule } from './games/games.module';
import { HealthModule } from './health/health.module';
import { UsersModule } from './users/users.module';

/**
 * The composition root.
 *
 * **Default-deny is the property this file exists to establish.** `JwtAuthGuard`
 * is mounted as a global `APP_GUARD`, so every route in every module is
 * protected unless it carries `@Public()`. A controller whose decorator was
 * forgotten fails closed. The previous generation opted in per router and
 * shipped five unauthenticated gameplay endpoints while its README asserted the
 * opposite; `PUBLIC_ROUTES` in the contract is now the allow-list, and it names
 * four routes.
 *
 * Guard order is the declaration order below, and it is deliberate: rate
 * limiting runs before authentication. Verifying a token — and, on the login
 * path, an Argon2 hash — is the expensive part, so the cheap check goes first;
 * a flood should be rejected before it can spend CPU.
 */
@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [APP_CONFIG],
      useFactory: throttlerOptionsFor,
    }),
    HealthModule,
    AuthModule,
    UsersModule,
    GamesModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    /**
     * Validates any parameter whose declared type carries a contract schema
     * (see `createZodDto`). Parameters that use `@ZodBody(schema)` and friends
     * carry their own instance; this one is the safety net, and it is
     * deliberately inert rather than guessing at unannotated values.
     *
     * `useValue` rather than `useClass`: the optional `schema` constructor
     * argument is not a DI token, and the container would try to resolve it.
     */
    { provide: APP_PIPE, useValue: new ZodValidationPipe() },
  ],
})
export class AppModule implements NestModule {
  /**
   * `{*splat}` rather than `'*'`: Express 5 uses path-to-regexp v8, which
   * rejects unnamed wildcards outright.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('{*splat}');
  }
}

/** Re-exported so `main.ts` can type the configuration it resolves. */
export type { AppConfig };
