import 'reflect-metadata';

import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { PATH_METADATA, METHOD_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_PREFIX, PUBLIC_ROUTES, ROUTES } from '@dice-game/contracts';
import { beforeAll, describe, expect, it } from 'vitest';

import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';

import { AppModule } from './app.module';
import { mountApiDocs } from './docs';
import { parseAppConfig } from './config/env.schema';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';
import {
  CREDENTIALS_RATE_LIMIT,
  RATE_LIMIT_TIER_KEY,
  RATE_LIMIT_TIERS,
} from './config/rate-limit.config';

/**
 * The whole-application route audit.
 *
 * Per-controller reflection tests are not enough, and that is not a theoretical
 * objection — a mutation review of this code found that adding `@Public()` to
 * `GET /api/users` turned it into an unauthenticated user-enumeration endpoint
 * with the entire suite still green, and that removing `@Public()` from `login`
 * caused a total authentication outage, also with the suite green. Only
 * `GamesController` had such a test, so only `GamesController` was defended.
 *
 * This walks every controller Nest actually registers, so a controller added
 * tomorrow is covered without anyone remembering to write a test for it. The
 * previous generation of this project shipped five unauthenticated gameplay
 * endpoints while its README asserted the opposite; the point of default-deny
 * is that the guard fails closed, and the point of this file is that the
 * *allow-list* cannot drift without something going red.
 *
 * Controller metadata alone is not sufficient, and that too was found the hard
 * way. Swagger mounts on the raw Express adapter, so `/api/docs`, its static
 * assets and `/api/docs-json` are not Nest routes at all: no guard, no
 * throttler, no envelope — and invisible to `DiscoveryService`. The first
 * version of this file asserted "mounts nothing else" while seven such paths
 * answered 200 without a token. `describe('the Express router')` below is the
 * part that catches anything mounted underneath Nest rather than through it.
 */

interface MountedRoute {
  readonly controller: string;
  readonly handler: string;
  readonly method: RequestMethod;
  readonly path: string;
  readonly isPublic: boolean;
  readonly httpCode: number | undefined;
  readonly rateLimitTier: string | undefined;
  readonly skipsRateLimit: boolean;
}

let routes: readonly MountedRoute[];

function joinPath(...segments: readonly string[]): string {
  const joined = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter((segment) => segment.length > 0)
    .join('/');

  return `/${joined}`;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [DiscoveryModule, AppModule],
  }).compile();

  const discovered = moduleRef.get(DiscoveryService).getControllers();

  routes = discovered.flatMap((wrapper): MountedRoute[] => {
    const controller = wrapper.metatype;

    if (typeof controller !== 'function') {
      return [];
    }

    // Cast through `unknown`: a controller without @Controller() has no such
    // metadata, so this really can be undefined however the types read.
    const controllerPath =
      (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ?? '';
    const controllerIsPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;

    return Object.getOwnPropertyNames(controller.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => (controller.prototype as Record<string, unknown>)[name])
      .filter(
        (handler): handler is (...args: unknown[]) => unknown =>
          typeof handler === 'function' && Reflect.hasMetadata(PATH_METADATA, handler),
      )
      .map((handler) => ({
        controller: controller.name,
        handler: handler.name,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        path: joinPath(
          API_PREFIX,
          controllerPath,
          Reflect.getMetadata(PATH_METADATA, handler) as string,
        ),
        isPublic: controllerIsPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true,
        httpCode: Reflect.getMetadata(HTTP_CODE_METADATA, handler) as number | undefined,
        rateLimitTier: (Reflect.getMetadata(RATE_LIMIT_TIER_KEY, handler) ??
          Reflect.getMetadata(RATE_LIMIT_TIER_KEY, controller)) as string | undefined,
        // `SkipThrottle` stores one key per named throttler
        // (`THROTTLER:SKIPgeneral`), not a single flag. A route that skipped
        // only one tier would still be throttled by the other, so both are
        // required here — which is the whole reason SkipRateLimit() names them.
        skipsRateLimit: RATE_LIMIT_TIERS.every(
          (tier) =>
            Reflect.getMetadata(`${THROTTLER_SKIP}${tier}`, handler) === true ||
            Reflect.getMetadata(`${THROTTLER_SKIP}${tier}`, controller) === true,
        ),
      }));
  });
});

describe('the set of routes reachable without a token', () => {
  it('is exactly the set the contract publishes as public', () => {
    const actuallyPublic = routes
      .filter((route) => route.isPublic)
      .map((route) => route.path)
      .sort();

    // Equality, not containment. Containment would let a new @Public() route
    // through, which is the mutation that survived before this test existed.
    expect(actuallyPublic).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('leaves every other route to the global guard', () => {
    const guarded = routes.filter((route) => !route.isPublic).map((route) => route.path);

    expect(guarded.length).toBeGreaterThan(0);

    for (const path of guarded) {
      expect(PUBLIC_ROUTES, `${path} is guarded but the contract lists it as public`).not.toContain(
        path,
      );
    }
  });

  it('guards the user list, which is an enumeration endpoint if it is not', () => {
    const list = routes.find((route) => route.path === ROUTES.users.list);

    expect(list).toBeDefined();
    expect(list?.isPublic).toBe(false);
  });

  it('leaves register and login public, or nobody can obtain a token', () => {
    for (const path of [ROUTES.auth.register, ROUTES.auth.login]) {
      expect(routes.find((route) => route.path === path)?.isPublic, path).toBe(true);
    }
  });
});

describe('every route the contract names', () => {
  const expected: readonly [string, RequestMethod, number][] = [
    [ROUTES.auth.register, RequestMethod.POST, 201],
    [ROUTES.auth.login, RequestMethod.POST, 200],
    [ROUTES.auth.logout, RequestMethod.POST, 204],
    [ROUTES.auth.me, RequestMethod.GET, 200],
    [ROUTES.users.list, RequestMethod.GET, 200],
    [ROUTES.games.create, RequestMethod.POST, 201],
    [ROUTES.games.byId(':gameId'), RequestMethod.GET, 200],
    [ROUTES.games.roll(':gameId'), RequestMethod.POST, 200],
    [ROUTES.games.hold(':gameId'), RequestMethod.POST, 200],
    [ROUTES.games.newGame(':gameId'), RequestMethod.POST, 200],
    [ROUTES.health.live, RequestMethod.GET, 200],
    [ROUTES.health.ready, RequestMethod.GET, 200],
  ];

  it.each(expected)('mounts %s with the method the contract implies', (path, method) => {
    const route = routes.find((candidate) => candidate.path === path);

    expect(route, `no handler mounted at ${path}`).toBeDefined();
    expect(route?.method).toBe(method);
  });

  /**
   * Success statuses were entirely unasserted before this: all three
   * `@HttpCode(OK)` decorators could be deleted from the games controller at
   * once — turning roll, hold and new-game into 201s — with the suite green.
   * Nest defaults POST to 201, so every one of these is a real decision.
   */
  it.each(expected)(
    'answers %s with the status a client should expect',
    (path, _method, status) => {
      const route = routes.find((candidate) => candidate.path === path);
      const declared = route?.httpCode;
      const effective = declared ?? (route?.method === RequestMethod.POST ? 201 : 200);

      expect(effective, `${path} answers ${String(effective)}, expected ${String(status)}`).toBe(
        status,
      );
    },
  );

  it('mounts nothing else', () => {
    const mounted = routes.map((route) => route.path).sort();

    expect(mounted).toEqual(expected.map(([path]) => path).sort());
  });
});

/**
 * A budget sized for gameplay is a budget sized for thousands of password
 * guesses an hour, so the credential endpoints draw on their own much smaller
 * tier. Deleting either decorator was invisible to the suite before this.
 */
describe('rate-limit tiers', () => {
  it('puts register and login on the credentials budget', () => {
    for (const path of [ROUTES.auth.register, ROUTES.auth.login]) {
      const route = routes.find((candidate) => candidate.path === path);

      expect(route?.rateLimitTier, `${path} is not on the credentials tier`).toEqual(
        CREDENTIALS_RATE_LIMIT,
      );
    }
  });

  it('leaves gameplay on the general budget', () => {
    for (const path of [ROUTES.games.roll(':gameId'), ROUTES.games.hold(':gameId')]) {
      const route = routes.find((candidate) => candidate.path === path);

      expect(
        route?.rateLimitTier,
        `${path} must not inherit the credential budget`,
      ).toBeUndefined();
    }
  });

  it('exempts the health probes, so a poller cannot throttle itself into a restart', () => {
    for (const path of [ROUTES.health.live, ROUTES.health.ready]) {
      expect(routes.find((candidate) => candidate.path === path)?.skipsRateLimit, path).toBe(true);
    }
  });
});

/**
 * The router-level audit.
 *
 * `DiscoveryService` answers "what did Nest register?". This answers "what will
 * actually respond?" — which is a strictly larger set, and the difference is
 * exactly where an unguarded route hides.
 */
describe('the Express router', () => {
  async function servedPathsWith(nodeEnv: string): Promise<readonly string[]> {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = moduleRef.createNestApplication<NestExpressApplication>();

    app.setGlobalPrefix(API_PREFIX);

    // The production config is built here rather than injected, because what is
    // under test is the decision `mountApiDocs` makes — not the container.
    mountApiDocs(app, {
      ...parseAppConfig({
        NODE_ENV: nodeEnv,
        JWT_SECRET: 'a-production-secret-of-entirely-sufficient-length',
        CORS_ORIGIN: 'https://dice.example',
        TRUST_PROXY_HOPS: '1',
      }),
    });

    await app.init();

    const instance = app.getHttpAdapter().getInstance() as unknown as {
      router?: { stack?: readonly { route?: { path?: string } }[] };
      _router?: { stack?: readonly { route?: { path?: string } }[] };
    };
    const layers = instance.router?.stack ?? instance._router?.stack ?? [];

    const served = layers
      .map((layer) => layer.route?.path)
      .filter((path): path is string => typeof path === 'string');

    await app.close();

    return served;
  }

  it('mounts no documentation in production, where nothing would guard it', async () => {
    const served = await servedPathsWith('production');
    const owned = new Set(routes.map((route) => route.path));
    const strangers = served.filter((path) => path.startsWith(API_PREFIX) && !owned.has(path));

    expect(strangers, `unguarded routes: ${strangers.join(', ')}`).toEqual([]);
    expect(served.some((path) => path.includes('/docs'))).toBe(false);
  });

  it('does mount it outside production, so the exclusion is the decision and not an accident', async () => {
    const served = await servedPathsWith('development');

    expect(served.some((path) => path.includes('/docs'))).toBe(true);
  });
});
