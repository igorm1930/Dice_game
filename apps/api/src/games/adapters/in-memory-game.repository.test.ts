import { beforeEach, describe, expect, it } from 'vitest';

import { applyHold, createGame, type GameState } from '../../domain/game';
import { standardRulesV1 } from '../../domain/rules/standard-v1';
import { type Clock } from '../ports/clock.port';
import { INITIAL_REVISION, type PersistedGame } from '../ports/game-repository.port';
import { InMemoryGameRepository } from './in-memory-game.repository';

/**
 * The repository owns two things the domain refuses to: the revision and the
 * timestamps. These assert both, and they assert the compare-and-set really is
 * one — the conflict path is the reason this port has the shape it has, and a
 * stand-in that always accepted a write would leave it untested until Phase 4.
 */

const GAME_ID = '507f1f77bcf86cd799439011';
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

describe('InMemoryGameRepository', () => {
  let clock: FakeClock;
  let repository: InMemoryGameRepository;

  beforeEach(() => {
    clock = new FakeClock();
    repository = new InMemoryGameRepository(clock);
  });

  describe('create', () => {
    it('stamps both timestamps from the clock', async () => {
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

    it('freezes what it stores, so a caller cannot edit the document in place', async () => {
      const stored = await repository.create(game());

      expect(Object.isFrozen(stored)).toBe(true);
    });
  });

  describe('findById', () => {
    it('answers null for an id nobody has used', async () => {
      expect(await repository.findById('507f1f77bcf86cd799439099')).toBeNull();
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
        GAME_ID,
        // The revision the *first* caller read. Stale now.
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
      const stored = await repository.updateIfRevisionMatches(
        '507f1f77bcf86cd799439099',
        0,
        created,
      );

      expect(stored).toBeNull();
    });
  });

  describe('clear', () => {
    it('empties the store', async () => {
      await repository.create(game());
      repository.clear();

      expect(await repository.findById(GAME_ID)).toBeNull();
    });
  });
});
