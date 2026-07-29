import 'reflect-metadata';

import { API_PREFIX, PUBLIC_ROUTES, ROUTES } from '@dice-game/contracts';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { GamesController } from './games.controller';

/**
 * The controller's own behaviour is one line per handler, so what is worth
 * asserting is its *wiring*: that it mounts exactly the routes the contract
 * names, and that none of them opted out of authentication.
 *
 * Both failures are silent ones. A path that drifted from the route table would
 * surface as a 404 in the browser weeks later; a stray `@Public()` would ship an
 * unauthenticated gameplay endpoint, which this repository has done before —
 * five of them, while the README claimed the opposite.
 */

const GAME_ID = '507f1f77bcf86cd799439011';

type Handler = keyof GamesController;

const HANDLERS = [
  'create',
  'findOne',
  'roll',
  'hold',
  'newGame',
] as const satisfies readonly Handler[];

/**
 * The handler function itself, read off the prototype's descriptor rather than
 * as `GamesController.prototype.roll` — the latter is an unbound method, and
 * reaching for one is a habit the linter is right to refuse even in a test.
 */
function handlerOf(handler: Handler): object {
  const descriptor = Object.getOwnPropertyDescriptor(GamesController.prototype, handler);

  if (descriptor === undefined) {
    throw new Error(`GamesController has no handler named ${handler}.`);
  }

  return descriptor.value as object;
}

/** The full path a handler mounts, including the global `/api` prefix. */
function pathOf(handler: Handler): string {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, GamesController) as string;
  const handlerPath = Reflect.getMetadata(PATH_METADATA, handlerOf(handler)) as string;

  return `${API_PREFIX}/${controllerPath}${handlerPath === '/' ? '' : `/${handlerPath}`}`;
}

function methodOf(handler: Handler): RequestMethod {
  return Reflect.getMetadata(METHOD_METADATA, handlerOf(handler)) as RequestMethod;
}

/** Substitutes a concrete id for the `:gameId` segment, as the router would. */
function withId(path: string): string {
  return path.replace(':gameId', GAME_ID);
}

describe('routes', () => {
  const expected: readonly [Handler, RequestMethod, string][] = [
    ['create', RequestMethod.POST, ROUTES.games.create],
    ['findOne', RequestMethod.GET, ROUTES.games.byId(GAME_ID)],
    ['roll', RequestMethod.POST, ROUTES.games.roll(GAME_ID)],
    ['hold', RequestMethod.POST, ROUTES.games.hold(GAME_ID)],
    ['newGame', RequestMethod.POST, ROUTES.games.newGame(GAME_ID)],
  ];

  it.each(expected)('mounts %s at the path the contract names', (handler, method, path) => {
    expect(withId(pathOf(handler))).toBe(path);
    expect(methodOf(handler)).toBe(method);
  });

  it('mounts nothing the contract does not name', () => {
    const mounted = Object.getOwnPropertyNames(GamesController.prototype).filter(
      (name) =>
        name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, handlerOf(name as Handler)),
    );

    expect(mounted.sort()).toEqual(expected.map(([handler]) => handler).sort());
  });
});

describe('authentication', () => {
  it('never opts the controller out of the global guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GamesController)).toBeUndefined();
  });

  it.each(HANDLERS)('never opts %s out of the global guard', (handler) => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handlerOf(handler))).toBeUndefined();
  });

  it('mounts no route the contract lists as public', () => {
    for (const handler of HANDLERS) {
      expect(PUBLIC_ROUTES).not.toContain(pathOf(handler));
    }
  });
});
