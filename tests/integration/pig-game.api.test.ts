import type { Express } from 'express';
import request from 'supertest';

import { createContainer } from '../../src/container';
import { FakePasswordHasher, ScriptedRandomGenerator } from '../support/fakes';

const PASSWORD = 'correct horse battery';

/**
 * End-to-end coverage of the Pig game through the real middleware stack.
 *
 * Two seams make this deterministic and fast: the RNG is scripted, so every
 * asserted score is exact and no assertion is probabilistic; and the password
 * hasher is faked, because the shipped one is deliberately ~100 ms per call and
 * this file registers dozens of players. The default winning score is pinned to
 * 20 so matches stay short.
 */
function buildApp(sequence: readonly number[]): Express {
  return createContainer({
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      LOG_PRETTY: false,
      RATE_LIMIT_MAX: 10_000,
      AUTH_RATE_LIMIT_MAX: 10_000,
      PIG_TARGET_SCORE: 20,
    },
    random: new ScriptedRandomGenerator(sequence),
    passwordHasher: new FakePasswordHasher(),
  }).app;
}

async function signUp(app: Express, username: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ username, password: PASSWORD })
    .expect(201);

  return response.body.data.token as string;
}

interface Table {
  readonly app: Express;
  readonly alice: string;
  readonly bob: string;
}

/** Signs both players in and starts a match between them. */
async function table(sequence: readonly number[], targetScore?: number): Promise<Table> {
  const app = buildApp(sequence);
  const alice = await signUp(app, 'alice');
  const bob = await signUp(app, 'bob');

  await request(app)
    .post('/api/v1/pig-game/new-game')
    .set('Authorization', `Bearer ${alice}`)
    .send(targetScore === undefined ? { opponent: 'bob' } : { opponent: 'bob', targetScore })
    .expect(201);

  return { app, alice, bob };
}

function roll(app: Express, token: string): request.Test {
  return request(app).post('/api/v1/pig-game/roll').set('Authorization', `Bearer ${token}`);
}

function hold(app: Express, token: string): request.Test {
  return request(app).post('/api/v1/pig-game/hold').set('Authorization', `Bearer ${token}`);
}

describe('Pig Game API', () => {
  describe('authentication is a precondition, not a suggestion', () => {
    it.each([
      ['GET', '/api/v1/pig-game'],
      ['POST', '/api/v1/pig-game/roll'],
      ['POST', '/api/v1/pig-game/hold'],
      ['POST', '/api/v1/pig-game/new-game'],
    ])('%s %s refuses an anonymous caller with 401', async (method, path) => {
      const app = buildApp([3]);

      const response = await (
        method === 'GET'
          ? request(app).get(path)
          : request(app).post(path).send({ opponent: 'bob' })
      ).expect(401);

      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['a malformed scheme', 'Token abc123'],
      ['a bare token', 'abc123'],
      ['an empty bearer', 'Bearer '],
    ])('rejects %s', async (_label, header) => {
      await request(buildApp([3]))
        .get('/api/v1/pig-game')
        .set('Authorization', header)
        .expect(401);
    });

    it('rejects a well-formed but unknown token', async () => {
      await request(buildApp([3]))
        .get('/api/v1/pig-game')
        .set('Authorization', 'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
        .expect(401);
    });
  });

  describe('before a match exists', () => {
    it('reports 404 rather than inventing an empty game', async () => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');

      const response = await request(app)
        .get('/api/v1/pig-game')
        .set('Authorization', `Bearer ${alice}`)
        .expect(404);

      expect(response.body.error.code).toBe('PIG_GAME_NOT_FOUND');
    });
  });

  describe('POST /api/v1/pig-game/new-game', () => {
    it('seats the caller and the named opponent and returns 201', async () => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');
      await signUp(app, 'bob');

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'bob' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        players: [
          { username: 'alice', wins: 0 },
          { username: 'bob', wins: 0 },
        ],
        totalScores: [0, 0],
        currentTurnScore: 0,
        activePlayer: 0,
        isPlaying: true,
        winner: null,
        lastRoll: null,
        bustedOnLastRoll: false,
        targetScore: 20,
        viewerSeat: 0,
      });
      expect(response.body.meta.requestId).toEqual(expect.any(String));
    });

    it('lets the players choose the winning score', async () => {
      const { app, alice } = await table([5], 50);

      const response = await request(app)
        .get('/api/v1/pig-game')
        .set('Authorization', `Bearer ${alice}`)
        .expect(200);

      expect(response.body.data.targetScore).toBe(50);
    });

    it('404s on an opponent who has not registered', async () => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'ghost' })
        .expect(404);

      expect(response.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('422s on a player trying to play themselves', async () => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'alice' })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_OPPONENT');
    });

    it.each([
      ['a missing opponent', {}],
      ['a non-integer winning score', { opponent: 'bob', targetScore: 50.5 }],
      ['a zero winning score', { opponent: 'bob', targetScore: 0 }],
      ['a non-numeric winning score', { opponent: 'bob', targetScore: 'first to fifty' }],
      ['an unknown field', { opponent: 'bob', target: 50 }],
    ])('rejects %s with 400', async (_label, body) => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');
      await signUp(app, 'bob');

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send(body)
        .expect(400);

      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('maps a well-formed but unplayable winning score to 422, distinct from a schema failure', async () => {
      const app = buildApp([3]);
      const alice = await signUp(app, 'alice');
      await signUp(app, 'bob');

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'bob', targetScore: 5000 })
        .expect(422);

      expect(response.body.error.code).toBe('INVALID_TARGET_SCORE');
      expect(response.body.error.details).toMatchObject({ requested: 5000, min: 2, max: 1000 });
    });

    it('may be started at any time, including mid-match', async () => {
      const { app, alice, bob } = await table([5]);
      await roll(app, alice).expect(200);

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${bob}`)
        .send({ opponent: 'alice' })
        .expect(201);

      expect(response.body.data).toMatchObject({
        players: [{ username: 'bob' }, { username: 'alice' }],
        totalScores: [0, 0],
        lastRoll: null,
      });
    });
  });

  describe('POST /api/v1/pig-game/roll', () => {
    it('adds the sum of both dice to the round score', async () => {
      const { app, alice } = await table([4, 3]);

      const response = await roll(app, alice).expect(200);

      expect(response.body.data).toMatchObject({
        lastRoll: [4, 3],
        currentTurnScore: 7,
        bustedOnLastRoll: false,
        activePlayer: 0,
        isPlaying: true,
      });
    });

    it('treats a single six as an ordinary six', async () => {
      const { app, alice } = await table([6, 2]);

      const response = await roll(app, alice).expect(200);

      expect(response.body.data).toMatchObject({
        lastRoll: [6, 2],
        currentTurnScore: 8,
        bustedOnLastRoll: false,
        activePlayer: 0,
      });
    });

    it('6 & 6 wipes the round score and passes the turn, leaving totals intact', async () => {
      const { app, alice } = await table([5, 5, 5, 5, 6, 6]);
      await roll(app, alice).expect(200); // 10
      await roll(app, alice).expect(200); // 20 — not banked, so no win

      const response = await roll(app, alice).expect(200);

      expect(response.body.data).toMatchObject({
        lastRoll: [6, 6],
        currentTurnScore: 0,
        bustedOnLastRoll: true,
        activePlayer: 1,
        totalScores: [0, 0],
        isPlaying: true,
      });
    });

    it('takes no request body — a supplied die is ignored, not honoured', async () => {
      const { app, alice } = await table([2, 2]);

      const response = await roll(app, alice).send({ lastRoll: [6, 6], totalScores: [99, 0] });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        lastRoll: [2, 2],
        currentTurnScore: 4,
        totalScores: [0, 0],
      });
    });
  });

  describe('turn enforcement', () => {
    it('403s the player whose turn it is not', async () => {
      const { app, bob } = await table([3, 3]);

      const response = await roll(app, bob).expect(403);

      expect(response.body.error.code).toBe('NOT_YOUR_TURN');
      expect(response.body.error.details).toMatchObject({ actor: 1, activePlayer: 0 });
    });

    it('403s a hold out of turn as well', async () => {
      const { app, bob } = await table([3, 3]);

      await hold(app, bob).expect(403);
    });

    it('403s an authenticated stranger who is not in the game', async () => {
      const { app } = await table([3, 3]);
      const carol = await signUp(app, 'carol');

      const response = await roll(app, carol).expect(403);

      expect(response.body.error.code).toBe('NOT_A_PARTICIPANT');
    });

    it('lets a stranger read the board but not touch it', async () => {
      const { app } = await table([3, 3]);
      const carol = await signUp(app, 'carol');

      const response = await request(app)
        .get('/api/v1/pig-game')
        .set('Authorization', `Bearer ${carol}`)
        .expect(200);

      expect(response.body.data.viewerSeat).toBeNull();
    });

    it('hands the turn over for real after a bust', async () => {
      const { app, alice, bob } = await table([6, 6, 2, 2]);
      await roll(app, alice).expect(200);

      await roll(app, alice).expect(403);
      const response = await roll(app, bob).expect(200);

      expect(response.body.data).toMatchObject({ currentTurnScore: 4, activePlayer: 1 });
    });
  });

  describe('POST /api/v1/pig-game/hold', () => {
    it('is legal on a zero round score and simply forfeits the turn', async () => {
      const { app, alice } = await table([5, 4]);

      const response = await hold(app, alice).expect(200);

      expect(response.body.data).toMatchObject({ totalScores: [0, 0], activePlayer: 1 });
    });

    it('banks exactly the round score that was showing', async () => {
      const { app, alice } = await table([5, 4]);
      await roll(app, alice).expect(200);

      const response = await hold(app, alice).expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [9, 0],
        currentTurnScore: 0,
        activePlayer: 1,
        isPlaying: true,
        winner: null,
      });
    });

    it('reaching the winning score wins the game and credits the player', async () => {
      const { app, alice } = await table([5, 5]);
      await roll(app, alice).expect(200); // 10
      await roll(app, alice).expect(200); // 20

      const response = await hold(app, alice).expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [20, 0],
        isPlaying: false,
        winner: 0,
        players: [{ username: 'alice', wins: 1 }, { username: 'bob' }],
      });
    });
  });

  describe('once the game is over', () => {
    async function finished(): Promise<Table> {
      const t = await table([5, 5]);
      await roll(t.app, t.alice).expect(200);
      await roll(t.app, t.alice).expect(200);
      await hold(t.app, t.alice).expect(200);
      return t;
    }

    it('rolling returns 409 PIG_GAME_OVER', async () => {
      const { app, alice } = await finished();

      const response = await roll(app, alice).expect(409);

      expect(response.body.error.code).toBe('PIG_GAME_OVER');
      expect(response.body.error.details).toMatchObject({ action: 'roll', winner: 0 });
    });

    it('holding returns 409 for the loser too', async () => {
      const { app, bob } = await finished();

      await hold(app, bob).expect(409);
    });

    it('a new game resets everything and play resumes', async () => {
      const { app, alice } = await finished();

      await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'bob' })
        .expect(201);

      await roll(app, alice).expect(200);
    });

    it('carries the win forward into the next match', async () => {
      const { app, alice } = await finished();

      const response = await request(app)
        .post('/api/v1/pig-game/new-game')
        .set('Authorization', `Bearer ${alice}`)
        .send({ opponent: 'bob' })
        .expect(201);

      expect(response.body.data.players[0].wins).toBe(1);
    });
  });

  describe('a full match', () => {
    it('plays deterministically to a player-2 victory', async () => {
      // P1 busts immediately on 6 & 6, P2 rolls 5+5 twice and holds on 20.
      const { app, alice, bob } = await table([6, 6, 5, 5, 5, 5]);

      await roll(app, alice).expect(200); // bust → P2's turn
      await roll(app, bob).expect(200); // 10
      await roll(app, bob).expect(200); // 20
      const response = await hold(app, bob).expect(200);

      expect(response.body.data).toMatchObject({
        totalScores: [0, 20],
        winner: 1,
        isPlaying: false,
        players: [{ wins: 0 }, { username: 'bob', wins: 1 }],
      });
    });
  });

  describe('shared-state semantics', () => {
    it('shows both players the same board', async () => {
      const { app, alice, bob } = await table([4, 4]);
      await roll(app, alice).expect(200);

      const asBob = await request(app)
        .get('/api/v1/pig-game')
        .set('Authorization', `Bearer ${bob}`)
        .expect(200);

      expect(asBob.body.data).toMatchObject({ currentTurnScore: 8, viewerSeat: 1 });
    });

    it('loses no rolls when actions arrive concurrently', async () => {
      const { app, alice } = await table([1, 1]);

      const responses = await Promise.all(Array.from({ length: 5 }, () => roll(app, alice)));

      expect(responses.every((response) => response.status === 200)).toBe(true);

      const final = await request(app)
        .get('/api/v1/pig-game')
        .set('Authorization', `Bearer ${alice}`);
      expect(final.body.data.currentTurnScore).toBe(10);
    });
  });
});
