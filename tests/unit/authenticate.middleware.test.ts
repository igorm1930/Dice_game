import type { Request } from 'express';

import { currentUser } from '../../src/http/middleware/authenticate.middleware';

describe('currentUser', () => {
  it('returns the player the middleware attached', () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      usernameKey: 'alice',
      passwordHash: 'irrelevant',
      wins: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(currentUser({ user } as unknown as Request)).toBe(user);
  });

  /**
   * The failure mode this guards against is a route that forgets to mount
   * `authenticate`. Returning `undefined` there would silently treat every
   * caller as anonymous; throwing turns it into an immediate, obvious 500.
   */
  it('throws rather than treating an unauthenticated request as anonymous', () => {
    expect(() => currentUser({} as Request)).toThrow(/Mount authenticate\(\)/);
  });
});
