import type { Express } from 'express';
import request from 'supertest';

import { createContainer } from '../../src/container';
import { ConstantRandomGenerator, FakePasswordHasher } from '../support/fakes';

const PASSWORD = 'correct horse battery';

function buildApp(overrides: Record<string, number> = {}): Express {
  return createContainer({
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: false,
      RATE_LIMIT_MAX: 10_000,
      AUTH_RATE_LIMIT_MAX: 10_000,
      ...overrides,
    },
    random: new ConstantRandomGenerator(3),
    passwordHasher: new FakePasswordHasher(),
  }).app;
}

describe('Auth API', () => {
  describe('POST /api/v1/auth/register', () => {
    it('creates a player and returns a token, 201', async () => {
      const response = await request(buildApp())
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);

      expect(response.body.data).toEqual({
        player: { id: expect.any(String), username: 'alice', wins: 0 },
        token: expect.any(String),
      });
    });

    it('409s a username already taken', async () => {
      const app = buildApp();
      await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'ALICE', password: PASSWORD })
        .expect(409);

      expect(response.body.error.code).toBe('USERNAME_TAKEN');
    });

    it.each([
      ['a username that is too short', { username: 'ab', password: PASSWORD }],
      ['a username with spaces', { username: 'a b', password: PASSWORD }],
      ['a username with punctuation', { username: 'alice!', password: PASSWORD }],
      ['a password under the length floor', { username: 'alice', password: 'short' }],
      ['a missing password', { username: 'alice' }],
      ['an unknown field', { username: 'alice', password: PASSWORD, admin: true }],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await request(buildApp())
        .post('/api/v1/auth/register')
        .send(body)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('never echoes the password or its hash', async () => {
      const response = await request(buildApp())
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);

      expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
      expect(response.body.data.player).not.toHaveProperty('passwordHash');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    async function withAlice(): Promise<Express> {
      const app = buildApp();
      await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);
      return app;
    }

    it('returns a token for the right password', async () => {
      const app = await withAlice();

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: PASSWORD })
        .expect(200);

      expect(response.body.data.token).toEqual(expect.any(String));
    });

    it('401s a wrong password', async () => {
      const app = await withAlice();

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'wrong password' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns a byte-identical body for an unknown user, so the endpoint is no enumeration oracle', async () => {
      const app = await withAlice();

      const wrongPassword = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'alice', password: 'wrong password' })
        .expect(401);

      const unknownUser = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'mallory', password: 'wrong password' })
        .expect(401);

      expect(unknownUser.body.error).toEqual(wrongPassword.body.error);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('identifies the bearer', async () => {
      const app = buildApp();
      const registered = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${registered.body.data.token as string}`)
        .expect(200);

      expect(response.body.data).toEqual({
        id: registered.body.data.player.id,
        username: 'alice',
        wins: 0,
      });
    });

    it('401s without a credential', async () => {
      await request(buildApp()).get('/api/v1/auth/me').expect(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the token, 204', async () => {
      const app = buildApp();
      const registered = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);
      const token = registered.body.data.token as string;

      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    });
  });

  describe('credential rate limiting', () => {
    /**
     * The general API budget is sized for gameplay. Password guessing gets its
     * own, far smaller one — otherwise a limit generous enough for dice is
     * generous enough for thousands of guesses an hour.
     */
    it('throttles repeated login attempts well before the gameplay limit', async () => {
      const app = buildApp({ AUTH_RATE_LIMIT_MAX: 3 });

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({ username: 'alice', password: 'guess guess guess' });
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 3)).toEqual([401, 401, 401]);
      expect(statuses.slice(3)).toEqual([429, 429]);
    });

    it('does not throttle gameplay at the credential limit', async () => {
      const app = buildApp({ AUTH_RATE_LIMIT_MAX: 3 });
      const alice = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'alice', password: PASSWORD })
        .expect(201);

      for (let attempt = 0; attempt < 6; attempt += 1) {
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${alice.body.data.token as string}`)
          .expect(200);
      }
    });
  });
});
