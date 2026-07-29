import 'reflect-metadata';

import { type AuthSession, type GameView, ROUTES } from '@dice-game/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type DicePair } from '../domain/dice';
import {
  clearDatabase,
  createIntegrationApp,
  type IntegrationApp,
} from '../testing/integration-app';

/**
 * Gameplay against a real MongoDB.
 *
 * The centre of this file is the revision guard. Everything else here is
 * behaviour the service suite already covers with a `Map`; the compare-and-set
 * is the one thing a `Map` cannot be wrong about in the same way a database can,
 * because "exactly one of two simultaneous writers wins" is a property of the
 * server's conditional update and not of this process.
 *
 * The dice are the deterministic generator — bound because `NODE_ENV=test`, see
 * `dice-generator.provider.ts` — scripted per test, so a double six is asserted
 * rather than waited for.
 *
 * `docker compose up -d` from the repository root must be running.
 */

/** Every roll throws this unless a test says otherwise: a plain, scoring 7. */
const SEVEN: DicePair = [3, 4];

/** The losing combination under `standard@1`. */
const DOUBLE_SIX: DicePair = [6, 6];

interface Failure {
  code: string;
  message: string;
  details?: unknown;
}

let instance: IntegrationApp;
let ada: AuthSession;
let grace: AuthSession;
let alan: AuthSession;

function bearer(session: AuthSession): string {
  return `Bearer ${session.accessToken}`;
}

async function registerPlayer(email: string, displayName: string): Promise<AuthSession> {
  const response = await instance.http
    .post(ROUTES.auth.register)
    .send({ email, displayName, password: 'a-perfectly-fine-password' })
    .expect(201);

  return response.body.data as AuthSession;
}

/** Ada creates a match against Grace and takes seat 0, which moves first. */
async function startGame(winningScore?: number): Promise<GameView> {
  const body =
    winningScore === undefined
      ? { opponentId: grace.user.id }
      : { opponentId: grace.user.id, winningScore };

  const response = await instance.http
    .post(ROUTES.games.create)
    .set('Authorization', bearer(ada))
    .send(body)
    .expect(201);

  return response.body.data as GameView;
}

function roll(
  session: AuthSession,
  gameId: string,
  expectedRevision: number,
): ReturnType<IntegrationApp['http']['post']> {
  return instance.http
    .post(ROUTES.games.roll(gameId))
    .set('Authorization', bearer(session))
    .send({ expectedRevision });
}

function hold(
  session: AuthSession,
  gameId: string,
  expectedRevision: number,
): ReturnType<IntegrationApp['http']['post']> {
  return instance.http
    .post(ROUTES.games.hold(gameId))
    .set('Authorization', bearer(session))
    .send({ expectedRevision });
}

async function read(session: AuthSession, gameId: string): Promise<GameView> {
  const response = await instance.http
    .get(ROUTES.games.byId(gameId))
    .set('Authorization', bearer(session))
    .expect(200);

  return response.body.data as GameView;
}

beforeAll(async () => {
  instance = await createIntegrationApp();
});

afterAll(async () => {
  await instance.close();
});

beforeEach(async () => {
  await clearDatabase(instance.mongo);

  // A single scripted throw, cycling. Every roll in every test therefore scores
  // 7 unless the test scripts something else, which makes each case independent
  // of how many throws the ones before it took.
  instance.dice.setSequence([SEVEN]);

  ada = await registerPlayer('ada@example.com', 'Ada Lovelace');
  grace = await registerPlayer('grace@example.com', 'Grace Hopper');
  alan = await registerPlayer('alan@example.com', 'Alan Turing');
});

describe('creating a game', () => {
  it('seats the creator first and stores it at the initial revision', async () => {
    const game = await startGame();

    expect(game.id).toMatch(/^[a-f\d]{24}$/i);
    expect(game.players[0]).toMatchObject({ userId: ada.user.id, globalScore: 0, winCount: 0 });
    expect(game.players[1]).toMatchObject({ userId: grace.user.id, globalScore: 0, winCount: 0 });
    expect(game.activePlayer).toBe(0);
    expect(game.gameNumber).toBe(1);
    expect(game.status).toBe('ACTIVE');
    expect(game.revision).toBe(0);
    expect(game.lastDice).toBeNull();
    expect(game.viewerSeat).toBe(0);
    expect(game.availableActions.canRoll).toBe(true);
  });

  it('refuses an opponent who does not exist', async () => {
    const response = await instance.http
      .post(ROUTES.games.create)
      .set('Authorization', bearer(ada))
      .send({ opponentId: '507f1f77bcf86cd799439099' })
      .expect(404);

    expect((response.body.error as Failure).code).toBe('USER_NOT_FOUND');
  });

  it('refuses a game against yourself', async () => {
    const response = await instance.http
      .post(ROUTES.games.create)
      .set('Authorization', bearer(ada))
      .send({ opponentId: ada.user.id })
      .expect(422);

    expect((response.body.error as Failure).code).toBe('INVALID_OPPONENT');
  });
});

describe('reading a game', () => {
  it('refuses a stranger the board, not merely the actions', async () => {
    const game = await startGame();

    const response = await instance.http
      .get(ROUTES.games.byId(game.id))
      .set('Authorization', bearer(alan))
      .expect(403);

    expect((response.body.error as Failure).code).toBe('NOT_A_PARTICIPANT');
    expect(response.body.data).toBeUndefined();
  });
});

describe('rolling', () => {
  it('adds the throw to the round score and keeps the turn', async () => {
    const game = await startGame();
    const response = await roll(ada, game.id, game.revision).expect(200);
    const rolled = response.body.data as GameView;

    expect(rolled.lastDice).toEqual(SEVEN);
    expect(rolled.effect).toBe('NORMAL_ROLL');
    expect(rolled.roundScore).toBe(7);
    expect(rolled.activePlayer).toBe(0);
    expect(rolled.revision).toBe(game.revision + 1);
  });

  it('wipes the round and passes the turn on a double six', async () => {
    const game = await startGame();

    await roll(ada, game.id, 0).expect(200);

    instance.dice.setSequence([DOUBLE_SIX]);

    const response = await roll(ada, game.id, 1).expect(200);
    const busted = response.body.data as GameView;

    expect(busted.lastDice).toEqual(DOUBLE_SIX);
    expect(busted.effect).toBe('DOUBLE_SIX');
    expect(busted.roundScore).toBe(0);
    expect(busted.activePlayer).toBe(1);
    // Only unbanked points are at risk: neither global score moved.
    expect(busted.players.map((player) => player.globalScore)).toEqual([0, 0]);
  });

  it('refuses the player whose turn it is not', async () => {
    const game = await startGame();
    const response = await roll(grace, game.id, game.revision).expect(403);

    expect((response.body.error as Failure).code).toBe('NOT_YOUR_TURN');
    expect((await read(ada, game.id)).revision).toBe(0);
  });

  it('refuses a non-member without telling them whose turn it is', async () => {
    const game = await startGame();
    const response = await roll(alan, game.id, game.revision).expect(403);

    expect((response.body.error as Failure).code).toBe('NOT_A_PARTICIPANT');
  });
});

describe('holding', () => {
  it('banks the round score and passes the turn', async () => {
    const game = await startGame();

    await roll(ada, game.id, 0).expect(200);

    const response = await hold(ada, game.id, 1).expect(200);
    const held = response.body.data as GameView;

    expect(held.effect).toBe('HELD');
    expect(held.players[0].globalScore).toBe(7);
    expect(held.roundScore).toBe(0);
    expect(held.activePlayer).toBe(1);
    expect(held.status).toBe('ACTIVE');
  });

  it('wins the game when the banked total reaches the target', async () => {
    const game = await startGame(2);

    await roll(ada, game.id, 0).expect(200);

    const response = await hold(ada, game.id, 1).expect(200);
    const won = response.body.data as GameView;

    expect(won.status).toBe('COMPLETED');
    expect(won.winner).toBe(0);
    expect(won.effect).toBe('GAME_WON');
    expect(won.players[0].winCount).toBe(1);
    expect(won.players[1].winCount).toBe(0);
  });
});

describe('a completed game', () => {
  it('refuses every further action, for either player', async () => {
    const game = await startGame(2);

    await roll(ada, game.id, 0).expect(200);

    const won = (await hold(ada, game.id, 1).expect(200)).body.data as GameView;

    const adaRolls = await roll(ada, game.id, won.revision).expect(409);
    const graceRolls = await roll(grace, game.id, won.revision).expect(409);

    expect((adaRolls.body.error as Failure).code).toBe('GAME_OVER');
    // Game over is reported ahead of any turn violation: a finished game is
    // finished for everyone, and "not your turn" would describe a match that is
    // no longer in progress.
    expect((graceRolls.body.error as Failure).code).toBe('GAME_OVER');
  });
});

/**
 * The revision guard, which is the reason this whole suite exists.
 *
 * ADR-0002: the write is a conditional update matched on `{ _id, revision }`
 * and incremented atomically. No matching document means the client's view was
 * stale, and the action is **not replayed** — replaying a stale Roll would spend
 * a turn the player did not knowingly take.
 */
describe('the revision guard', () => {
  it('refuses a stale revision and leaves the game where it was', async () => {
    const game = await startGame();

    await roll(ada, game.id, 0).expect(200);

    const stale = await roll(ada, game.id, 0).expect(409);

    expect((stale.body.error as Failure).code).toBe('GAME_REVISION_CONFLICT');
    expect((stale.body.error as Failure).details).toEqual({
      gameId: game.id,
      expectedRevision: 0,
    });

    const current = await read(ada, game.id);

    // One roll, not two: the refused action was discarded rather than queued.
    expect(current.revision).toBe(1);
    expect(current.roundScore).toBe(7);
  });

  /**
   * Two genuinely simultaneous writers, against a real server.
   *
   * This is the double-clicked Roll, and it is the case an in-memory `Map`
   * cannot honestly stand in for: both requests read revision 0, both compute a
   * next state, and both issue `findOneAndUpdate({ _id, revision: 0 })`. MongoDB
   * orders them; the first matches and increments, the second matches nothing.
   *
   * Exactly one 200 and exactly one 409, and — the part that matters — the game
   * advanced by exactly one roll.
   */
  it('lets exactly one of two simultaneous rolls through', async () => {
    const game = await startGame();

    const [first, second] = await Promise.all([roll(ada, game.id, 0), roll(ada, game.id, 0)]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);

    expect(statuses).toEqual([200, 409]);

    const loser = first.status === 409 ? first : second;

    expect((loser.body.error as Failure).code).toBe('GAME_REVISION_CONFLICT');

    const current = await read(ada, game.id);

    expect(current.revision).toBe(1);
    // 7, not 14. The refused roll was not replayed after a refetch.
    expect(current.roundScore).toBe(7);
  });

  it('lets exactly one of two simultaneous holds through', async () => {
    const game = await startGame();

    await roll(ada, game.id, 0).expect(200);

    const [first, second] = await Promise.all([hold(ada, game.id, 1), hold(ada, game.id, 1)]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const current = await read(ada, game.id);

    // Banked once. A replayed hold would have banked an empty round and handed
    // the turn back, which is a quieter and worse failure than a conflict.
    expect(current.players[0].globalScore).toBe(7);
    expect(current.revision).toBe(2);
  });
});

describe('new game', () => {
  it('resets the board, keeps the win counts and increments the game number', async () => {
    const game = await startGame(2);

    await roll(ada, game.id, 0).expect(200);

    const won = (await hold(ada, game.id, 1).expect(200)).body.data as GameView;

    const response = await instance.http
      .post(ROUTES.games.newGame(game.id))
      .set('Authorization', bearer(ada))
      .send({ expectedRevision: won.revision })
      .expect(200);

    const next = response.body.data as GameView;

    expect(next.effect).toBe('NEW_GAME');
    expect(next.gameNumber).toBe(2);
    expect(next.status).toBe('ACTIVE');
    expect(next.winner).toBeNull();
    expect(next.activePlayer).toBe(0);
    expect(next.roundScore).toBe(0);
    expect(next.lastDice).toBeNull();
    expect(next.players.map((player) => player.globalScore)).toEqual([0, 0]);
    // The series continues: the win survives the reset.
    expect(next.players[0].winCount).toBe(1);
  });
});

/**
 * Persistence, asserted the only way it can honestly be asserted: by asking a
 * different container, with a different connection, about a game the first one
 * wrote. Nothing is shared between the two but MongoDB.
 */
describe('persistence across a restart', () => {
  it('serves the same board from a fresh repository instance', async () => {
    const game = await startGame();

    await roll(ada, game.id, 0).expect(200);

    const before = await read(ada, game.id);

    const restarted = await createIntegrationApp();

    try {
      const response = await restarted.http
        .get(ROUTES.games.byId(game.id))
        .set('Authorization', bearer(ada))
        .expect(200);

      expect(response.body.data).toEqual(before);
    } finally {
      await restarted.close();
    }
  });

  it('keeps win counts across the restart, so the series survives a deploy', async () => {
    const game = await startGame(2);

    await roll(ada, game.id, 0).expect(200);

    const won = (await hold(ada, game.id, 1).expect(200)).body.data as GameView;

    await instance.http
      .post(ROUTES.games.newGame(game.id))
      .set('Authorization', bearer(ada))
      .send({ expectedRevision: won.revision })
      .expect(200);

    const restarted = await createIntegrationApp();

    try {
      const response = await restarted.http
        .get(ROUTES.games.byId(game.id))
        .set('Authorization', bearer(grace))
        .expect(200);

      const seen = response.body.data as GameView;

      expect(seen.players[0].winCount).toBe(1);
      expect(seen.gameNumber).toBe(2);
      expect(seen.players.map((player) => player.globalScore)).toEqual([0, 0]);
      // And the other seat is still the other seat.
      expect(seen.viewerSeat).toBe(1);
    } finally {
      await restarted.close();
    }
  });
});
