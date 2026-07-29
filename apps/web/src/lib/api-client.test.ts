import { authSessionSchema, gameViewSchema, REFETCH_ON, ROUTES } from '@dice-game/contracts';
import { describe, expect, it, vi } from 'vitest';

import { fail, installFakeApi, ok } from '@/test/fake-api';
import { ADA, authSession, gameView, GAME_ID, TOKEN_A } from '@/test/fixtures';

import { apiRequest, ApiError, isRefetchable } from './api-client';

describe('a successful response', () => {
  it('returns the payload from inside the envelope, parsed by the contract schema', async () => {
    const api = installFakeApi();
    const view = gameView({ roundScore: 12, revision: 7 });
    api.route('GET', ROUTES.games.byId(GAME_ID), () => ok(view));

    const result = await apiRequest({
      path: ROUTES.games.byId(GAME_ID),
      method: 'GET',
      token: TOKEN_A,
      schema: gameViewSchema,
    });

    expect(result).toEqual(view);
  });

  it('sends the token it was given, and only when it was given one', async () => {
    const api = installFakeApi();
    api.route('POST', ROUTES.auth.login, () => ok(authSession(ADA, TOKEN_A)));
    api.route('GET', ROUTES.auth.me, () => ok({ ...ADA, email: 'ada@example.com' }));

    await apiRequest({
      path: ROUTES.auth.login,
      method: 'POST',
      body: { email: 'ada@example.com', password: 'correct-horse-battery' },
      schema: authSessionSchema,
    });

    await apiRequest({
      path: ROUTES.auth.me,
      method: 'GET',
      token: TOKEN_A,
      schema: authSessionSchema.shape.user,
    });

    expect(api.callsTo('POST', ROUTES.auth.login)[0]?.token).toBeNull();
    expect(api.callsTo('GET', ROUTES.auth.me)[0]?.token).toBe(TOKEN_A);
  });
});

describe('a failure', () => {
  it('surfaces the server’s own error code', async () => {
    const api = installFakeApi();
    api.route('POST', ROUTES.auth.login, () => fail('INVALID_CREDENTIALS'));

    const error = await apiRequest({
      path: ROUTES.auth.login,
      method: 'POST',
      body: {},
      schema: authSessionSchema,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('INVALID_CREDENTIALS');
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).kind).toBe('api');
  });

  it('rejects a 200 whose body the contract cannot parse', async () => {
    const api = installFakeApi();
    // A field the contract requires, missing. A client that rendered this would
    // be rendering a shape the server does not promise.
    api.route('GET', ROUTES.games.byId(GAME_ID), () => ok({ id: GAME_ID }));

    const error = await apiRequest({
      path: ROUTES.games.byId(GAME_ID),
      method: 'GET',
      token: TOKEN_A,
      schema: gameViewSchema,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('contract');
  });

  it('reports an unreachable server as a transport failure rather than a crash', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

    const error = await apiRequest({
      path: ROUTES.auth.me,
      method: 'GET',
      token: TOKEN_A,
      schema: authSessionSchema,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('transport');
    expect((error as ApiError).status).toBe(0);
  });
});

describe('deciding what to refetch on', () => {
  it('agrees with the contract’s REFETCH_ON list rather than a list of its own', () => {
    for (const code of REFETCH_ON) {
      const error = new ApiError({
        kind: 'api',
        code,
        message: 'stale',
        status: 409,
        requestId: null,
      });

      expect(isRefetchable(error)).toBe(true);
    }
  });

  it('does not swallow a failure that is not on the list', () => {
    const error = new ApiError({
      kind: 'api',
      code: 'NOT_A_PARTICIPANT',
      message: 'no',
      status: 403,
      requestId: null,
    });

    expect(isRefetchable(error)).toBe(false);
    expect(isRefetchable(new Error('something else'))).toBe(false);
  });
});
