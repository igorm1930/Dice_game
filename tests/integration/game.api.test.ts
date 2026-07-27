import type { Express } from 'express';
import request from 'supertest';

import { createContainer } from '../../src/container';

/**
 * Integration tests drive the real application through the full middleware
 * stack — correlation id, helmet, validation, routing, error mapping — via
 * supertest, with no port bound and no network.
 *
 * The only substitution is a silent logger, because a test run should not emit
 * a few hundred lines of NDJSON.
 */
function buildApp(): Express {
  return createContainer({
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent', LOG_PRETTY: false, RATE_LIMIT_MAX: 10_000 },
  }).app;
}

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

describe('Game API', () => {
  let app: Express;

  beforeEach(() => {
    app = buildApp();
  });

  describe('POST /api/v1/games', () => {
    it('creates a game and returns 201 with a Location header', async () => {
      const response = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada Lovelace' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        playerName: 'Ada Lovelace',
        status: 'IN_PROGRESS',
        totalRounds: 5,
        roundsPlayed: 0,
        roundsRemaining: 5,
        totalScore: 0,
        rounds: [],
        completedAt: null,
      });
      expect(response.headers.location).toBe(`/api/v1/games/${response.body.data.id}`);
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('never leaks the internal version field', async () => {
      const response = await request(app).post('/api/v1/games').send({ playerName: 'Ada' });

      expect(response.body.data).not.toHaveProperty('version');
    });

    it('honours an explicit round count', async () => {
      const response = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 3 })
        .expect(201);

      expect(response.body.data.totalRounds).toBe(3);
    });

    it.each([
      ['missing playerName', {}],
      ['empty playerName', { playerName: '' }],
      ['oversized playerName', { playerName: 'x'.repeat(65) }],
      ['illegal characters', { playerName: '<script>alert(1)</script>' }],
      ['non-integer rounds', { playerName: 'Ada', rounds: 2.5 }],
      ['zero rounds', { playerName: 'Ada', rounds: 0 }],
      ['unknown field', { playerName: 'Ada', admin: true }],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await request(app).post('/api/v1/games').send(body).expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(Array.isArray(response.body.error.details)).toBe(true);
    });

    it('maps a domain rule violation to 422, distinct from a schema failure', async () => {
      // Shape is valid (integer, <= 100) but exceeds the configured GAME_MAX_ROUNDS.
      const response = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 50 })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_ROUND_COUNT');
      expect(response.body.error.details).toMatchObject({ requested: 50, maxRounds: 20 });
    });

    it('returns 400 for malformed JSON rather than 500', async () => {
      const response = await request(app)
        .post('/api/v1/games')
        .set('Content-Type', 'application/json')
        .send('{"playerName": ')
        .expect(400);

      expect(response.body.error.code).toBe('MALFORMED_REQUEST_BODY');
    });
  });

  describe('GET /api/v1/games/:gameId', () => {
    it('returns the current game state', async () => {
      const created = await request(app).post('/api/v1/games').send({ playerName: 'Ada' });

      const response = await request(app).get(`/api/v1/games/${created.body.data.id}`).expect(200);

      expect(response.body.data.id).toBe(created.body.data.id);
    });

    it('returns 404 for an unknown game', async () => {
      const response = await request(app).get(`/api/v1/games/${VALID_UUID}`).expect(404);

      expect(response.body.error.code).toBe('GAME_NOT_FOUND');
    });

    it('returns 400 — not 404 — for a malformed id', async () => {
      const response = await request(app).get('/api/v1/games/not-a-uuid').expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/games/:gameId/rolls', () => {
    it('plays a round and returns the round plus updated game', async () => {
      const created = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 2 });

      const response = await request(app)
        .post(`/api/v1/games/${created.body.data.id}/rolls`)
        .expect(201);

      const { round, game } = response.body.data;

      expect(round.index).toBe(1);
      expect(round.dice).toHaveLength(2);
      round.dice.forEach((die: number) => {
        expect(die).toBeGreaterThanOrEqual(1);
        expect(die).toBeLessThanOrEqual(6);
      });
      expect(round.pips).toBe(round.dice[0] + round.dice[1]);
      expect(['SNAKE_EYES', 'DOUBLES', 'LUCKY_SEVEN', 'STANDARD']).toContain(round.outcome);
      expect(game.roundsPlayed).toBe(1);
      expect(game.totalScore).toBe(round.scoreAfter);
    });

    it('completes the game on the last round', async () => {
      const created = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 1 });

      const response = await request(app)
        .post(`/api/v1/games/${created.body.data.id}/rolls`)
        .expect(201);

      expect(response.body.data.game.status).toBe('COMPLETED');
      expect(response.body.data.game.completedAt).toEqual(expect.any(String));
    });

    it('returns 409 when rolling a completed game', async () => {
      const created = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 1 });
      await request(app).post(`/api/v1/games/${created.body.data.id}/rolls`);

      const response = await request(app)
        .post(`/api/v1/games/${created.body.data.id}/rolls`)
        .expect(409);

      expect(response.body.error.code).toBe('GAME_ALREADY_COMPLETED');
    });

    it('returns 404 for an unknown game', async () => {
      await request(app).post(`/api/v1/games/${VALID_UUID}/rolls`).expect(404);
    });

    it('keeps the running total consistent across a full game', async () => {
      const created = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 5 });
      const id = created.body.data.id;

      let expectedTotal = 0;
      for (let i = 1; i <= 5; i += 1) {
        const response = await request(app).post(`/api/v1/games/${id}/rolls`).expect(201);
        expectedTotal += response.body.data.round.points;

        expect(response.body.data.round.index).toBe(i);
        expect(response.body.data.game.totalScore).toBe(expectedTotal);
      }

      const final = await request(app).get(`/api/v1/games/${id}`).expect(200);
      expect(final.body.data.status).toBe('COMPLETED');
      expect(final.body.data.rounds).toHaveLength(5);
    });

    it('loses no rounds when rolls arrive concurrently', async () => {
      const created = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Ada', rounds: 5 });
      const id = created.body.data.id;

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post(`/api/v1/games/${id}/rolls`)),
      );

      expect(responses.every((r) => r.status === 201)).toBe(true);

      // Numeric comparator, not the default lexicographic sort.
      const indexes = responses
        .map((r) => (r.body as { data: { round: { index: number } } }).data.round.index)
        .sort((a, b) => a - b);
      expect(indexes).toEqual([1, 2, 3, 4, 5]);

      const final = await request(app).get(`/api/v1/games/${id}`);
      expect(final.body.data.rounds).toHaveLength(5);
      expect(final.body.data.status).toBe('COMPLETED');
    });
  });

  describe('GET /api/v1/games', () => {
    it('paginates and reports hasMore', async () => {
      for (const name of ['A', 'B', 'C']) {
        await request(app).post('/api/v1/games').send({ playerName: name });
      }

      const first = await request(app).get('/api/v1/games?limit=2&offset=0').expect(200);

      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.pagination).toEqual({
        total: 3,
        limit: 2,
        offset: 0,
        hasMore: true,
      });

      const second = await request(app).get('/api/v1/games?limit=2&offset=2').expect(200);
      expect(second.body.data.pagination.hasMore).toBe(false);
    });

    it('applies defaults when no query is supplied', async () => {
      const response = await request(app).get('/api/v1/games').expect(200);

      expect(response.body.data.pagination).toMatchObject({ limit: 20, offset: 0 });
    });

    it('rejects an out-of-range limit', async () => {
      await request(app).get('/api/v1/games?limit=500').expect(400);
    });
  });

  describe('GET /api/v1/leaderboard', () => {
    it('ranks completed games and excludes those in progress', async () => {
      const finished = await request(app)
        .post('/api/v1/games')
        .send({ playerName: 'Finisher', rounds: 1 });
      await request(app).post(`/api/v1/games/${finished.body.data.id}/rolls`);
      await request(app).post('/api/v1/games').send({ playerName: 'Quitter', rounds: 5 });

      const response = await request(app).get('/api/v1/leaderboard').expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({ rank: 1, playerName: 'Finisher' });
    });

    it('orders by descending score', async () => {
      for (let i = 0; i < 6; i += 1) {
        const game = await request(app)
          .post('/api/v1/games')
          .send({ playerName: `P${i}`, rounds: 1 });
        await request(app).post(`/api/v1/games/${game.body.data.id}/rolls`);
      }

      const response = await request(app).get('/api/v1/leaderboard').expect(200);
      const entries = response.body.data as { totalScore: number; rank: number }[];
      const scores = entries.map((entry) => entry.totalScore);

      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      expect(entries.map((entry) => entry.rank)).toEqual(entries.map((_, i) => i + 1));
    });
  });
});
