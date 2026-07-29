import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX } from '@dice-game/contracts';
import type { INestApplication } from '@nestjs/common';

import type { AppConfig } from './config/env.schema';

/**
 * Mounts the interactive API documentation — outside production only.
 *
 * This lives in its own module rather than inline in `bootstrap()` so a test can
 * call it and assert what it mounts. That is not tidiness: Swagger registers on
 * the **raw Express adapter**, so `/api/docs`, its static assets, `/api/docs-json`
 * and `/api/docs-yaml` are not Nest routes. They bypass the global `APP_GUARD`,
 * the throttler and the response envelope, and they are invisible to
 * `DiscoveryService` — a security review found seven of them answering 200
 * without a token and without a rate limit, none named by `PUBLIC_ROUTES`.
 *
 * Schema disclosure is not an authentication bypass, but it is an
 * unauthenticated, unmetered surface the contract claims does not exist. Outside
 * production the convenience is worth it; in production it is not.
 *
 * @returns whether the documentation was mounted.
 */
export function mountApiDocs(app: INestApplication, config: AppConfig): boolean {
  if (config.isProduction) {
    return false;
  }

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Dice Game API')
      .setDescription(
        'Server-authoritative two-player dice game. Every rule, every die and every score is decided here.',
      )
      .setVersion(config.observability.serviceVersion)
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .build(),
  );

  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  return true;
}
