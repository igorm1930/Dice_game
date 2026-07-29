import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type MongoConnection } from '../../persistence/mongo-connection';
import { clearDatabase, newTestConnection } from '../../testing/integration-app';
import { EmailTakenError } from '../auth.errors';
import { type NewUser } from '../ports/user-repository.port';
import { MongoUserRepository } from './mongo-user.repository';

/**
 * The user port, asserted against MongoDB.
 *
 * Same cases as `InMemoryUserRepository`'s consumers rely on, plus the three
 * things only a real server can answer: the unique index under contention, an
 * atomic `$inc` on `tokenVersion`, and what happens when an id or an address
 * that is not a string reaches a filter.
 */

const ADA: NewUser = {
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  passwordHash: '$argon2id$v=19$m=8192,p=1,t=1$notarealhash$notarealdigest',
};

const GRACE: NewUser = {
  email: 'grace@example.com',
  displayName: 'Grace Hopper',
  passwordHash: '$argon2id$v=19$m=8192,p=1,t=1$notarealhash$anotherdigest',
};

let mongo: MongoConnection;
let repository: MongoUserRepository;

beforeAll(async () => {
  mongo = newTestConnection();
  repository = new MongoUserRepository(mongo);

  // Opens the connection and builds the unique index on `email`, awaited. The
  // duplicate tests below are meaningless without it, and would pass.
  await mongo.onModuleInit();
});

afterAll(async () => {
  await mongo.onApplicationShutdown();
});

beforeEach(async () => {
  await clearDatabase(mongo);
});

describe('create', () => {
  it('mints a 24-character hex id, the shape the contract accepts', async () => {
    const created = await repository.create(ADA);

    expect(created.id).toMatch(/^[a-f\d]{24}$/i);
    expect(created.tokenVersion).toBe(0);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it('normalises the address on the way in', async () => {
    const created = await repository.create({ ...ADA, email: '  Ada@Example.COM ' });

    expect(created.email).toBe('ada@example.com');
    expect(await repository.findByEmail('ADA@example.com')).not.toBeNull();
  });

  it('raises EmailTakenError from the unique index, not from a lookup', async () => {
    await repository.create(ADA);

    await expect(repository.create({ ...ADA, displayName: 'Ada Byron' })).rejects.toBeInstanceOf(
      EmailTakenError,
    );
  });

  /**
   * The race a find-then-create loses.
   *
   * Five inserts on one address, all in flight. The index admits one and the
   * server rejects four with E11000, which the adapter maps to
   * `EmailTakenError`. A check performed in the service before the insert would
   * let every one of these through.
   */
  it('admits exactly one of five simultaneous registrations', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, () => repository.create(ADA)),
    );

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    for (const outcome of rejected) {
      expect(outcome.reason).toBeInstanceOf(EmailTakenError);
    }

    expect((await repository.list({ limit: 10, offset: 0 })).total).toBe(1);
  });
});

describe('findById', () => {
  it('finds the account it just stored', async () => {
    const created = await repository.create(ADA);

    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('answers null for a well-formed id nobody has', async () => {
    expect(await repository.findById('507f1f77bcf86cd799439099')).toBeNull();
  });

  /**
   * A malformed id is `null`, never a `CastError`.
   *
   * The guard calls this with whatever a token's `sub` claim held, and a forged
   * token can hold anything. "No such user" has to be a `null` at every call
   * site or the 401 path becomes a 500 — and a 500 is a distinguishable answer,
   * which is precisely what the authentication failures are careful not to be.
   */
  it('answers null for an id that is not one', async () => {
    expect(await repository.findById('not-an-object-id')).toBeNull();
    expect(await repository.findById('')).toBeNull();
  });

  /**
   * The NoSQL operator, at the port rather than over HTTP.
   *
   * `auth.integration.spec.ts` proves the contract schema rejects this with a
   * 400. This proves the layer behind it is not relying on that: an id that is a
   * query selector fails `idSchema`, so it never becomes an `ObjectId` and never
   * reaches a filter.
   */
  it('cannot be made to match with a query selector', async () => {
    await repository.create(ADA);
    await repository.create(GRACE);

    const injected = { $ne: null } as unknown as string;

    expect(await repository.findById(injected)).toBeNull();
    expect(await repository.incrementTokenVersion(injected)).toBeNull();
  });
});

describe('incrementTokenVersion', () => {
  it('returns the new version, so logout can be made real', async () => {
    const created = await repository.create(ADA);

    expect(await repository.incrementTokenVersion(created.id)).toBe(1);
    expect((await repository.findById(created.id))?.tokenVersion).toBe(1);
  });

  it('answers null for a user who is not there, rather than throwing', async () => {
    expect(await repository.incrementTokenVersion('507f1f77bcf86cd799439099')).toBeNull();
  });

  /**
   * Concurrent logouts each land, because the increment happens on the server.
   *
   * A read-modify-write here would let two of them compute the same next
   * version, and one set of tokens would keep verifying — a revocation that
   * silently did not revoke.
   */
  it('never loses an increment under contention', async () => {
    const created = await repository.create(ADA);

    const versions = await Promise.all(
      Array.from({ length: 5 }, () => repository.incrementTokenVersion(created.id)),
    );

    expect([...versions].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([1, 2, 3, 4, 5]);
    expect((await repository.findById(created.id))?.tokenVersion).toBe(5);
  });
});

describe('list', () => {
  it('pages in a stable order and reports the size of the whole collection', async () => {
    await repository.create(ADA);
    await repository.create(GRACE);
    await repository.create({ ...ADA, email: 'alan@example.com', displayName: 'Alan Turing' });

    const first = await repository.list({ limit: 2, offset: 0 });
    const second = await repository.list({ limit: 2, offset: 2 });

    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);

    // No row on two pages and none missing: the order is total, so paging is
    // coherent rather than approximately coherent.
    const ids = [...first.items, ...second.items].map((user) => user.id);

    expect(new Set(ids).size).toBe(3);
  });

  it('is empty, not an error, when nobody has registered', async () => {
    expect(await repository.list({ limit: 25, offset: 0 })).toEqual({ items: [], total: 0 });
  });
});
