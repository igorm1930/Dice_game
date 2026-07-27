import type { Express } from 'express';
import request from 'supertest';

import { createContainer } from '../../src/container';
import { ScriptedRandomGenerator } from '../support/fakes';

/**
 * End-to-end coverage of the Pig game through the real middleware stack.
 *
 * The container's RNG seam is what makes this deterministic: the die sequence
 * is scripted, so every asserted score is exact — no probabilistic assertions.
 * The default target is pinned to 20 so winning sequences stay short.
 */
function buildApp(sequence: readonly number[]): Express {
  return createContainer({
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: false,
      RATE_LIMIT_MAX: 10_000,
      PIG_TARGET_SCORE: 20,
    },
    random: new ScriptedRandomGenerator(sequence),
  }).app;
}

describe('Pig Game API', () => {
  describe('GET /api/v1/pig-game', () => {
    it('returns the initial shared state', async () => {
      const response = await request(buildApp([2]))
        .get('/api/v1/pig-game')
        .expect(200);

      expect(response.body.data).toEqual({
        totalScores: [0, 0],
        currentTurnScore: 0,
        activePlayer: 0,
        isPlaying: true,
        winner: null,
        lastRoll: null,
        targetScore: 20,
      });
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('never leaks the internal version field', async () => {
      const response = await request(buildApp([2])).get('/api/v1/pig-game');

      expect(response.body.data).not.toHaveProperty('version');
    });
  });

  describe('POST /api/v1/pig-game/roll', () => {
    it('adds a 1-5 roll to the current turn score', async () => {
      const app = buildApp([5]);

      const response = await request(app).post('/api/v1/pig-game/roll').expect(200);

      expect(response.body.data).toMatchObject({
        currentTurnScore: 5,
        lastRoll: 5,
        activePlayer: 0,
        isPlaying: true,
      });
    });

    it('a 6 busts: wipes the turn and switches players, leaving totals intact', async () => {
      const app = buildApp([5, 5, 6]);
      await request(app).post('/api/v1/pig-game/roll');
      await request(app).post('/api/v1/pig-game/roll');

      const response = await request(app).post('/api/v1/pig-game/roll').expect(200);

      expect(response.body.data).toMatchObject({
        currentTurnScore: 0,
        activePlayer: 1,
        lastRoll: 6,
        totalScores: [0, 0],
      });
    });
  });

  describe('POST /api/v1/pig-game/hold', () => {
    it('banks the turn score and hands play over', async () => {
      const app = buildApp([5, 4]);
      await request(app).post('/api/v1/pig-game/roll');
      await request(app).post('/api/v1/pig-game/roll');

      const response = await request(app).post('/api/v1/pig-game/hold').expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [9, 0],
        currentTurnScore: 0,
        activePlayer: 1,
        isPlaying: true,
        winner: null,
      });
    });

    it('reaching the target score wins the game', async () => {
      const app = buildApp([5]);
      for (let i = 0; i < 4; i += 1) {
        await request(app).post('/api/v1/pig-game/roll');
      }

      const response = await request(app).post('/api/v1/pig-game/hold').expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [20, 0],
        isPlaying: false,
        winner: 0,
      });
    });
  });

  describe('POST /api/v1/pig-game/new-game', () => {
    it('with no body resets to the default target', async () => {
      const app = buildApp([5]);
      await request(app).post('/api/v1/pig-game/roll');

      const reset = await request(app).post('/api/v1/pig-game/new-game').expect(200);

      expect(reset.body.data).toEqual({
        totalScores: [0, 0],
        currentTurnScore: 0,
        activePlayer: 0,
        isPlaying: true,
        winner: null,
        lastRoll: null,
        targetScore: 20,
      });
    });

    it('lets the players choose the target for the new match', async () => {
      const app = buildApp([5]);

      const reset = await request(app)
        .post('/api/v1/pig-game/new-game')
        .send({ targetScore: 100 })
        .expect(200);

      expect(reset.body.data.targetScore).toBe(100);

      // The chosen target governs the win: 20 banked is no longer enough.
      for (let i = 0; i < 4; i += 1) {
        await request(app).post('/api/v1/pig-game/roll');
      }
      const held = await request(app).post('/api/v1/pig-game/hold').expect(200);
      expect(held.body.data).toMatchObject({ totalScores: [20, 0], isPlaying: true });
    });

    it.each([
      ['a non-integer target', { targetScore: 50.5 }],
      ['a zero target', { targetScore: 0 }],
      ['a non-numeric target', { targetScore: 'first to fifty' }],
      ['an unknown field', { target: 50 }],
    ])('rejects %s with 400', async (_label, body) => {
      const response = await request(buildApp([2]))
        .post('/api/v1/pig-game/new-game')
        .send(body)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('maps a well-formed but unplayable target to 422, distinct from a schema failure', async () => {
      const response = await request(buildApp([2]))
        .post('/api/v1/pig-game/new-game')
        .send({ targetScore: 5000 })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_TARGET_SCORE');
      expect(response.body.error.details).toMatchObject({ requested: 5000, min: 2, max: 1000 });
    });
  });

  describe('once the game is over', () => {
    async function finishedApp(): Promise<Express> {
      const app = buildApp([5]);
      for (let i = 0; i < 4; i += 1) {
        await request(app).post('/api/v1/pig-game/roll');
      }
      await request(app).post('/api/v1/pig-game/hold');
      return app;
    }

    it('rolling returns 409 PIG_GAME_OVER', async () => {
      const app = await finishedApp();

      const response = await request(app).post('/api/v1/pig-game/roll').expect(409);

      expect(response.body.error.code).toBe('PIG_GAME_OVER');
      expect(response.body.error.details).toMatchObject({ action: 'roll', winner: 0 });
    });

    it('holding returns 409 PIG_GAME_OVER', async () => {
      const app = await finishedApp();

      await request(app).post('/api/v1/pig-game/hold').expect(409);
    });

    it('new-game resets everything and play resumes', async () => {
      const app = await finishedApp();

      await request(app).post('/api/v1/pig-game/new-game').expect(200);
      await request(app).post('/api/v1/pig-game/roll').expect(200);
    });
  });

  describe('state machine over a full match', () => {
    it('plays a deterministic two-player game to a player-1 victory', async () => {
      // P0: rolls 6 immediately -> busts -> P1's turn.
      // P1: 5, 5, 5, 5 -> holds 20 -> wins.
      const app = buildApp([6, 5, 5, 5, 5]);

      await request(app).post('/api/v1/pig-game/roll'); // P0 busts
      for (let i = 0; i < 4; i += 1) {
        await request(app).post('/api/v1/pig-game/roll');
      }
      const response = await request(app).post('/api/v1/pig-game/hold').expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [0, 20],
        winner: 1,
        isPlaying: false,
      });
    });
  });

  describe('shared-state semantics', () => {
    it('every client sees the same game', async () => {
      const app = buildApp([4]);
      await request(app).post('/api/v1/pig-game/roll');

      // A "different client" (new request) reads the same state.
      const response = await request(app).get('/api/v1/pig-game').expect(200);
      expect(response.body.data.currentTurnScore).toBe(4);
    });

    it('loses no rolls when actions arrive concurrently', async () => {
      const app = buildApp([2]);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post('/api/v1/pig-game/roll')),
      );

      expect(responses.every((r) => r.status === 200)).toBe(true);

      const final = await request(app).get('/api/v1/pig-game');
      expect(final.body.data.currentTurnScore).toBe(10);
    });
  });
});
