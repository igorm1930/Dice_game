import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyHold, createGame, type GameState } from '../../domain/game';
import { standardRulesV1 } from '../../domain/rules/standard-v1';
import { type MongoConnection } from '../../persistence/mongo-connection';
import { clearDatabase, newTestConnection } from '../../testing/integration-app';
import { type Clock } from '../ports/clock.port';
import { INITIAL_REVISION, type PersistedGame } from '../ports/game-repository.port';
import { MongoGameRepository } from './mongo-game.repository';

/**
 * The port contract, asserted against MongoDB rather than a `Map`.
 *
 * These are deliberately the *same* assertions as
 * `in-memory-game.repository.test.ts`, case for case: the two adapters are
 * bound to one token and consumers cannot tell them apart, so anything the unit
 * suite relies on has to be true of the real one too. Where they diverge — and
 * only there — this file adds the cases a `Map` cannot honestly answer:
 * concurrency and durability.
 */

const GAME_ID = '507f1f77bcf86cd799439011';
const MISSING_ID = '507f1f77bcf86cd799439099';
const ADA = { userId: '507f1f77bcf86cd799439012', displayName: 'Ada' };
const GRACE = { userId: '507f1f77bcf86cd799439013', displayName: 'Grace' };

/** A hand-written clock — no mocking framework, and no tolerance windows. */
class FakeClock implements Clock {
  private current: Date;

  constructor(start = new Date('2026-07-28T10:00:00.000Z')) {
    this.current = start;
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function game(): GameState {
  return createGame({ id: GAME_ID, players: [ADA, GRACE] });
}

let mongo: MongoConnection;
let clock: FakeClock;
let repository: MongoGameRepository;

beforeAll(async () => {
  mongo = newTestConnection();
  clock = new FakeClock();
  // Constructed before the connection opens, exactly as Nest does it: every
  // provider first, lifecycle hooks after. That ordering is what lets the hook
  // build indexes for models the repositories registered.
  repository = new MongoGameRepository(mongo, clock);

  await mongo.onModuleInit();
});

afterAll(async () => {
  await mongo.onApplicationShutdown();
});

beforeEach(async () => {
  await clearDatabase(mongo);
  clock = new FakeClock();
  repository = new MongoGameRepository(mongo, clock);
});

describe('create', () => {
  it('stamps both timestamps from the injected clock, not from the server', async () => {
    const stored = await repository.create(game());

    expect(stored.createdAt).toEqual(new Date('2026-07-28T10:00:00.000Z'));
    expect(stored.updatedAt).toEqual(new Date('2026-07-28T10:00:00.000Z'));
  });

  it('sets the initial revision itself rather than trusting the argument', async () => {
    const stored = await repository.create({ ...game(), revision: 41 });

    expect(stored.revision).toBe(INITIAL_REVISION);
  });

  it('makes the game findable by its id', async () => {
    const created = await repository.create(game());

    expect(await repository.findById(GAME_ID)).toEqual(created);
  });

  it('freezes what it hands back, so a caller cannot edit a document in place', async () => {
    const stored = await repository.create(game());

    expect(Object.isFrozen(stored)).toBe(true);
  });
});

describe('findById', () => {
  it('answers null for an id nobody has used', async () => {
    expect(await repository.findById(MISSING_ID)).toBeNull();
  });

  it('round-trips every field the domain cares about', async () => {
    const created = await repository.create(game());
    const found = await repository.findById(GAME_ID);

    expect(found).toEqual(created);
    expect(found?.players[0]).toEqual({ ...ADA, globalScore: 0, winCount: 0 });
    expect(found?.lastDice).toBeNull();
    expect(found?.ruleset).toEqual({ id: 'standard', version: 1 });
  });
});

describe('updateIfRevisionMatches', () => {
  let created: PersistedGame;

  beforeEach(async () => {
    created = await repository.create(game());
  });

  it('increments the revision, because the domain never does', async () => {
    const next = applyHold(created, ADA.userId, standardRulesV1);

    expect(next.revision).toBe(created.revision);

    const stored = await repository.updateIfRevisionMatches(GAME_ID, created.revision, next);

    expect(stored?.revision).toBe(created.revision + 1);
  });

  it('moves updatedAt and leaves createdAt where it was', async () => {
    clock.advance(60_000);

    const stored = await repository.updateIfRevisionMatches(
      GAME_ID,
      created.revision,
      applyHold(created, ADA.userId, standardRulesV1),
    );

    expect(stored?.createdAt).toEqual(created.createdAt);
    expect(stored?.updatedAt).toEqual(new Date('2026-07-28T10:01:00.000Z'));
  });

  it('answers null when the stored document has moved on', async () => {
    const first = await repository.updateIfRevisionMatches(
      GAME_ID,
      created.revision,
      applyHold(created, ADA.userId, standardRulesV1),
    );

    expect(first).not.toBeNull();

    const second = await repository.updateIfRevisionMatches(
      // The revision the *first* caller read. Stale now.
      GAME_ID,
      created.revision,
      applyHold(created, ADA.userId, standardRulesV1),
    );

    expect(second).toBeNull();
  });

  it('leaves the stored game untouched when it refuses a write', async () => {
    await repository.updateIfRevisionMatches(
      GAME_ID,
      created.revision,
      applyHold(created, ADA.userId, standardRulesV1),
    );

    const afterFirst = await repository.findById(GAME_ID);

    await repository.updateIfRevisionMatches(GAME_ID, created.revision, {
      ...created,
      roundScore: 999,
    });

    expect(await repository.findById(GAME_ID)).toEqual(afterFirst);
  });

  it('answers null for a game that does not exist', async () => {
    const stored = await repository.updateIfRevisionMatches(MISSING_ID, 0, created);

    expect(stored).toBeNull();
  });

  /**
   * The case the `Map` cannot stand in for.
   *
   * Ten writers, all quoting revision 0, all in flight at once. MongoDB matches
   * exactly one — the conditional update is atomic on the server — and the other
   * nine are told `null`. Nothing here retries, so nine actions are discarded
   * rather than queued, which is what makes a double-clicked Roll one roll.
   */
  it('lets exactly one of ten simultaneous writers through', async () => {
    const next = applyHold(created, ADA.userId, standardRulesV1);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        repository.updateIfRevisionMatches(GAME_ID, created.revision, next),
      ),
    );

    const winners = results.filter((result) => result !== null);

    expect(winners).toHaveLength(1);
    expect(winners[0]?.revision).toBe(created.revision + 1);
    // One increment, not ten: the losers did not write at all.
    expect((await repository.findById(GAME_ID))?.revision).toBe(created.revision + 1);
  });
});

/**
 * Durability, from a second repository over a second connection. The first one
 * is still open, so this is "another instance", which is the property the
 * previous generation lacked — it locked on a module-level constant and had
 * shipped as an HA pair by accident.
 */
describe('a second instance', () => {
  it('sees what the first one wrote, and contends with it on the same revision', async () => {
    const created = await repository.create(game());

    const otherMongo = newTestConnection();
    const other = new MongoGameRepository(otherMongo, new FakeClock());

    await otherMongo.onModuleInit();

    try {
      expect(await other.findById(GAME_ID)).toEqual(created);

      const next = applyHold(created, ADA.userId, standardRulesV1);
      const [mine, theirs] = await Promise.all([
        repository.updateIfRevisionMatches(GAME_ID, created.revision, next),
        other.updateIfRevisionMatches(GAME_ID, created.revision, next),
      ]);

      expect([mine, theirs].filter((result) => result !== null)).toHaveLength(1);
    } finally {
      await otherMongo.onApplicationShutdown();
    }
  });
});
