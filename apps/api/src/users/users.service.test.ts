import { paginationQuerySchema, userSummarySchema } from '@dice-game/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryUserRepository } from '../auth/adapters/in-memory-user.repository';
import { ValidationError } from '../common/errors/api-error';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

/**
 * The opponent picker's data source.
 *
 * The endpoint is authenticated by the global guard — `users.controller.ts`
 * carries no `@Public()`, and `jwt-auth.guard.test.ts` covers the default-deny
 * behaviour — so what is left to assert here is the other half: that the rows it
 * returns are narrow, and that a caller cannot ask for all of them at once.
 */

const PEOPLE = [
  { email: 'ada@example.com', displayName: 'Ada', passwordHash: 'argon2id:one' },
  { email: 'grace@example.com', displayName: 'Grace', passwordHash: 'argon2id:two' },
  { email: 'alan@example.com', displayName: 'Alan', passwordHash: 'argon2id:three' },
];

let repository: InMemoryUserRepository;
let users: UsersService;

beforeEach(async () => {
  repository = new InMemoryUserRepository();
  users = new UsersService(repository);

  for (const person of PEOPLE) {
    await repository.create(person);
  }
});

describe('the user list', () => {
  it('returns id and display name, and nothing else — never an email', async () => {
    const page = await users.list({ limit: 25, offset: 0 });

    expect(page.items).toHaveLength(PEOPLE.length);

    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'id']);
      expect(userSummarySchema.safeParse(item).success).toBe(true);
    }

    const serialised = JSON.stringify(page);

    for (const person of PEOPLE) {
      expect(serialised).not.toContain(person.email);
      expect(serialised).not.toContain(person.passwordHash);
    }
  });

  it('reports the total and whether another page exists', async () => {
    const first = await users.list({ limit: 2, offset: 0 });

    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.hasMore).toBe(true);

    const second = await users.list({ limit: 2, offset: 2 });

    expect(second.items).toHaveLength(1);
    expect(second.total).toBe(3);
    expect(second.hasMore).toBe(false);
  });

  it('pages without repeating or dropping a row', async () => {
    const first = await users.list({ limit: 2, offset: 0 });
    const second = await users.list({ limit: 2, offset: 2 });
    const ids = [...first.items, ...second.items].map((item) => item.id);

    expect(new Set(ids).size).toBe(PEOPLE.length);
  });

  it('reports an empty tail rather than claiming there is more', async () => {
    const page = await users.list({ limit: 25, offset: 99 });

    expect(page.items).toEqual([]);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(false);
  });
});

/**
 * An unbounded list is a user-enumeration endpoint however innocuous the two
 * fields look, so the bound is part of the contract rather than a default the
 * handler chose.
 */
describe('the query is bounded by the contract', () => {
  const pipe = new ZodValidationPipe(paginationQuerySchema);

  it('defaults to a bounded page when nothing is asked for', () => {
    expect(pipe.transform({}, { type: 'query' })).toEqual({ limit: 25, offset: 0 });
  });

  it('refuses a page size beyond the contract maximum', () => {
    expect(() => pipe.transform({ limit: '101' }, { type: 'query' })).toThrow(ValidationError);
    expect(() => pipe.transform({ limit: '0' }, { type: 'query' })).toThrow(ValidationError);
    expect(() => pipe.transform({ offset: '-1' }, { type: 'query' })).toThrow(ValidationError);
  });

  it('refuses an unrecognised parameter rather than ignoring it', () => {
    expect(() => pipe.transform({ email: 'ada@example.com' }, { type: 'query' })).toThrow(
      ValidationError,
    );
    expect(() => pipe.transform({ all: 'true' }, { type: 'query' })).toThrow(ValidationError);
  });
});
