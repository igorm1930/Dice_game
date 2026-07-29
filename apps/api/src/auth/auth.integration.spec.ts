import 'reflect-metadata';

import { type AuthSession, ROUTES } from '@dice-game/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  clearDatabase,
  createIntegrationApp,
  type IntegrationApp,
} from '../testing/integration-app';

/**
 * Authentication against a real MongoDB.
 *
 * The properties asserted here are properties of the *database*, which is why
 * they belong in this suite and not beside the service:
 *
 *  - uniqueness is a unique index, so two simultaneous registrations produce one
 *    account and one 409 rather than two accounts;
 *  - `tokenVersion` is a stored field, so a logout survives the process that
 *    performed it — the thing Phase 3 could not do;
 *  - a query selector submitted as an email is rejected at the edge and cannot
 *    match a document even if it were not.
 *
 * `docker compose up -d` from the repository root must be running.
 */

const ADA = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  password: 'correct-horse-battery',
};

const GRACE = {
  email: 'grace@example.com',
  displayName: 'Grace Hopper',
  password: 'another-good-password',
};

interface Failure {
  code: string;
  message: string;
  details?: unknown;
}

let instance: IntegrationApp;

function bearer(session: AuthSession): string {
  return `Bearer ${session.accessToken}`;
}

async function register(target: IntegrationApp, who: typeof ADA): Promise<AuthSession> {
  const response = await target.http.post(ROUTES.auth.register).send(who).expect(201);

  return response.body.data as AuthSession;
}

beforeAll(async () => {
  instance = await createIntegrationApp();
});

afterAll(async () => {
  await instance.close();
});

beforeEach(async () => {
  await clearDatabase(instance.mongo);
});

describe('registration', () => {
  it('creates an account and signs the new user straight in', async () => {
    const response = await instance.http.post(ROUTES.auth.register).send(ADA).expect(201);
    const session = response.body.data as AuthSession;

    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.expiresIn).toBeGreaterThan(0);
    expect(session.user.email).toBe(ADA.email);
    expect(session.user.displayName).toBe(ADA.displayName);
    // The id is Mongo's, and it is the shape the contract's `idSchema` accepts.
    expect(session.user.id).toMatch(/^[a-f\d]{24}$/i);
  });

  it('never serialises the password hash, however the account is read back', async () => {
    const session = await register(instance, ADA);
    const me = await instance.http
      .get(ROUTES.auth.me)
      .set('Authorization', bearer(session))
      .expect(200);

    expect(JSON.stringify(me.body)).not.toContain('argon2');
    expect(me.body.data).toEqual({
      id: session.user.id,
      email: ADA.email,
      displayName: ADA.displayName,
    });
  });

  it('persists the account, so a second instance can log it in', async () => {
    await register(instance, ADA);

    const restarted = await createIntegrationApp();

    try {
      await restarted.http
        .post(ROUTES.auth.login)
        .send({ email: ADA.email, password: ADA.password })
        .expect(200);
    } finally {
      await restarted.close();
    }
  });

  it('normalises the address, so Ada@Example.com is not a second account', async () => {
    await register(instance, ADA);

    const response = await instance.http
      .post(ROUTES.auth.register)
      .send({ ...ADA, email: 'Ada@Example.COM' })
      .expect(409);

    expect((response.body.error as Failure).code).toBe('EMAIL_TAKEN');
  });
});

describe('a duplicate email', () => {
  it('is refused with EMAIL_TAKEN', async () => {
    await register(instance, ADA);

    const response = await instance.http
      .post(ROUTES.auth.register)
      .send({ ...ADA, displayName: 'Someone Else' })
      .expect(409);

    expect((response.body.error as Failure).code).toBe('EMAIL_TAKEN');
    // No echo of the submitted address: registration necessarily reveals that
    // one is taken, but it need not reflect attacker-supplied text back.
    expect((response.body.error as Failure).details).toBeUndefined();
  });

  /**
   * The reason the check lives in the repository rather than in the service.
   *
   * A find-then-create is a race that *both* callers win: each looks, each sees
   * nothing, each inserts. Only the server can make the check atomic with the
   * insert, and this asserts that it does — with the real index, over the real
   * driver, from two requests in flight at once.
   */
  it('lets exactly one of two simultaneous registrations through', async () => {
    const [first, second] = await Promise.all([
      instance.http.post(ROUTES.auth.register).send(ADA),
      instance.http.post(ROUTES.auth.register).send({ ...ADA, displayName: 'Ada Byron' }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);

    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;

    expect((loser.body.error as Failure).code).toBe('EMAIL_TAKEN');
  });
});

describe('login', () => {
  it('exchanges correct credentials for a session', async () => {
    const registered = await register(instance, ADA);

    const response = await instance.http
      .post(ROUTES.auth.login)
      .send({ email: ADA.email, password: ADA.password })
      .expect(200);

    const session = response.body.data as AuthSession;

    expect(session.user.id).toBe(registered.user.id);
    expect(session.accessToken).toEqual(expect.any(String));
  });

  it('refuses a wrong password and an unknown address identically', async () => {
    await register(instance, ADA);

    const wrongPassword = await instance.http
      .post(ROUTES.auth.login)
      .send({ email: ADA.email, password: 'not-the-right-password' })
      .expect(401);

    const unknownAddress = await instance.http
      .post(ROUTES.auth.login)
      .send({ email: 'nobody@example.com', password: ADA.password })
      .expect(401);

    expect((wrongPassword.body.error as Failure).code).toBe('INVALID_CREDENTIALS');
    // Same code *and* same message. A difference in either is an enumeration
    // oracle for every address an attacker cares to try.
    expect(wrongPassword.body.error).toEqual(unknownAddress.body.error);
  });
});

describe('an invalid JWT', () => {
  it('is refused when the header is missing', async () => {
    const response = await instance.http.get(ROUTES.auth.me).expect(401);

    expect((response.body.error as Failure).code).toBe('UNAUTHENTICATED');
  });

  it('is refused when the token is not a token', async () => {
    const response = await instance.http
      .get(ROUTES.auth.me)
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);

    expect((response.body.error as Failure).code).toBe('UNAUTHENTICATED');
  });

  it('is refused when the signature has been tampered with', async () => {
    const session = await register(instance, ADA);
    const token = session.accessToken;
    const forged = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    const response = await instance.http
      .get(ROUTES.auth.me)
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);

    expect((response.body.error as Failure).code).toBe('UNAUTHENTICATED');
  });

  it('is refused when the user the token names no longer exists', async () => {
    const session = await register(instance, ADA);

    await clearDatabase(instance.mongo);

    const response = await instance.http
      .get(ROUTES.auth.me)
      .set('Authorization', bearer(session))
      .expect(401);

    expect((response.body.error as Failure).code).toBe('UNAUTHENTICATED');
  });
});

/**
 * NoSQL operator injection.
 *
 * `{ "email": { "$ne": null } }` is the canonical attack: submitted to a login
 * endpoint whose repository builds `{ email: <body.email> }`, it matches the
 * first account in the collection and hands over a session for somebody else's
 * identity. Three layers stand in the way and the tests below name each one.
 */
describe('a query selector submitted as an email', () => {
  it('is rejected by the contract schema before it reaches a query', async () => {
    await register(instance, ADA);

    const response = await instance.http
      .post(ROUTES.auth.login)
      .send({ email: { $ne: null }, password: ADA.password })
      .expect(400);

    expect((response.body.error as Failure).code).toBe('VALIDATION_ERROR');
    // Rejected *and* fruitless: no session, no token, nothing to replay.
    expect(response.body.data).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('accessToken');
  });

  it('is rejected on registration too, not only on login', async () => {
    const response = await instance.http
      .post(ROUTES.auth.register)
      .send({ email: { $ne: null }, displayName: ADA.displayName, password: ADA.password })
      .expect(400);

    expect((response.body.error as Failure).code).toBe('VALIDATION_ERROR');
  });

  /**
   * The backstop, asserted directly against the connection.
   *
   * If a filter were ever built without the validation pipe in front of it,
   * `sanitizeFilter` has to make the operator inert. This bypasses the whole API
   * and drives the driver: the honest filter finds Ada, so the query path
   * demonstrably works, and the operator filter finds nobody.
   *
   * **This test fails if `sanitizeFilter` is removed** — it was written against
   * a connection without it and returned Ada, which is exactly the compromise
   * being defended against. In mongoose 8 the observable signature is a rejected
   * cast: the operator is rewritten to `$eq: { $ne: null }` and a string path
   * cannot hold an object. Either outcome is "no user"; a returned document is
   * the bug, so that is what the assertion names.
   */
  it('cannot match a user even when handed straight to the driver', async () => {
    await register(instance, ADA);
    await register(instance, GRACE);

    const users = instance.mongo.connection.model('User');
    const honest = await users.findOne({ email: ADA.email }).exec();

    expect(honest, 'the honest filter must still find the account').not.toBeNull();

    const injected = await users
      .findOne({ email: { $ne: null } })
      .exec()
      .catch((): null => null);

    expect(injected, 'a query selector must never match an account').toBeNull();
  });
});

/**
 * The property Phase 3 could not have: revocation that outlives the process.
 *
 * `tokenVersion` used to live in a `Map`, so logging out and restarting handed
 * the old token its validity back — a logout that undid itself on deploy. It is
 * a stored field now, and this proves it by asking a *different container with a
 * different connection* about a token the first one revoked.
 */
describe('logout', () => {
  it('revokes every token for the user', async () => {
    const session = await register(instance, ADA);

    await instance.http.get(ROUTES.auth.me).set('Authorization', bearer(session)).expect(200);
    await instance.http.post(ROUTES.auth.logout).set('Authorization', bearer(session)).expect(204);
    await instance.http.get(ROUTES.auth.me).set('Authorization', bearer(session)).expect(401);
  });

  it('holds across a fresh repository instance', async () => {
    const session = await register(instance, ADA);

    await instance.http.post(ROUTES.auth.logout).set('Authorization', bearer(session)).expect(204);

    const restarted = await createIntegrationApp();

    try {
      const rejected = await restarted.http
        .get(ROUTES.auth.me)
        .set('Authorization', bearer(session))
        .expect(401);

      expect((rejected.body.error as Failure).code).toBe('UNAUTHENTICATED');

      // The account itself is untouched — logout revokes tokens, not users — so
      // a fresh login on the new instance works and yields a working token.
      const relogin = await restarted.http
        .post(ROUTES.auth.login)
        .send({ email: ADA.email, password: ADA.password })
        .expect(200);

      const renewed = relogin.body.data as AuthSession;

      await restarted.http.get(ROUTES.auth.me).set('Authorization', bearer(renewed)).expect(200);
    } finally {
      await restarted.close();
    }
  });
});
