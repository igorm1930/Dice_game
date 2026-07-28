import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { type AppConfig, loadAppConfig } from './env.schema';

/**
 * DI token for the validated, frozen {@link AppConfig}.
 *
 * Inject it rather than reaching for `ConfigService.get`: `ConfigService`
 * returns `string | undefined` for anything, which puts the burden of coercion
 * and defaulting back on every call site — exactly the drift this schema
 * exists to prevent.
 *
 * ```ts
 * constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
 * ```
 */
export const APP_CONFIG = 'APP_CONFIG';

/**
 * Loads `.env` (development convenience) and publishes the parsed configuration.
 *
 * `NestConfigModule.forRoot` assigns the env file's contents to `process.env`
 * synchronously as this module is evaluated, so the factory below — which runs
 * later, during dependency resolution — always sees the merged environment. Real
 * environments (Fly, CI) set variables directly and no file is involved.
 *
 * Global, because configuration is genuinely cross-cutting and threading a
 * `ConfigModule` import through every feature module would be ceremony.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Run from `apps/api`; the repository root holds the shared `.env`.
      envFilePath: ['.env', '../../.env'],
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadAppConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
