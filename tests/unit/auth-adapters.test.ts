import { UsernameTakenError, type User } from '../../src/core/domain/user';
import { InMemoryAuthTokenService } from '../../src/infrastructure/auth/in-memory-auth-token.service';
import { ScryptPasswordHasher } from '../../src/infrastructure/auth/scrypt-password-hasher';
import { InMemoryUserRepository } from '../../src/infrastructure/persistence/in-memory-user.repository';
import { FixedClock } from '../support/fakes';

function person(id: string, username: string): User {
  return {
    id,
    username,
    usernameKey: username.toLowerCase(),
    passwordHash: 'stored-hash',
    wins: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('ScryptPasswordHasher', () => {
  // The real KDF is deliberately slow; a handful of calls is worth the seconds.
  jest.setTimeout(20_000);

  const hasher = new ScryptPasswordHasher();

  it('round-trips a password', async () => {
    const stored = await hasher.hash('correct horse battery');

    await expect(hasher.verify('correct horse battery', stored)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const stored = await hasher.hash('correct horse battery');

    await expect(hasher.verify('Correct horse battery', stored)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const [first, second] = await Promise.all([hasher.hash('same'), hasher.hash('same')]);

    expect(first).not.toBe(second);
  });

  it('encodes its own parameters, so cost can be raised without invalidating old hashes', async () => {
    const stored = await hasher.hash('correct horse battery');

    expect(stored.split('$').slice(0, 4)).toEqual(['scrypt', '32768', '8', '1']);
  });

  it.each([
    ['empty', ''],
    ['a foreign format', 'bcrypt$2b$10$abcdef'],
    ['truncated', 'scrypt$32768$8$1$c2FsdA=='],
    ['non-numeric parameters', 'scrypt$N$r$p$c2FsdA==$aGFzaA=='],
    ['an empty digest', 'scrypt$32768$8$1$c2FsdA==$'],
  ])('treats %s stored value as a failed login rather than an error', async (_label, stored) => {
    await expect(hasher.verify('anything', stored)).resolves.toBe(false);
  });
});

describe('InMemoryAuthTokenService', () => {
  const TTL_MS = 1000;

  function build(): { clock: FixedClock; tokens: InMemoryAuthTokenService } {
    const clock = new FixedClock();
    return { clock, tokens: new InMemoryAuthTokenService({ clock, ttlMs: TTL_MS }) };
  }

  it('resolves a token it issued', async () => {
    const { tokens } = build();

    const token = await tokens.issue('user-1');

    await expect(tokens.resolve(token)).resolves.toBe('user-1');
  });

  it('issues distinct, high-entropy tokens', async () => {
    const { tokens } = build();

    const issued = await Promise.all(Array.from({ length: 25 }, () => tokens.issue('user-1')));

    expect(new Set(issued).size).toBe(25);
    // 32 bytes base64url — long enough that guessing is not a strategy.
    expect(issued.every((token) => token.length >= 42)).toBe(true);
  });

  it('returns null for a token it never issued', async () => {
    const { tokens } = build();

    await expect(tokens.resolve('made-up')).resolves.toBeNull();
  });

  it('expires a token once its lifetime has elapsed', async () => {
    const { clock, tokens } = build();
    const token = await tokens.issue('user-1');

    clock.advance(TTL_MS);

    await expect(tokens.resolve(token)).resolves.toBeNull();
  });

  it('still honours a token one millisecond before it expires', async () => {
    const { clock, tokens } = build();
    const token = await tokens.issue('user-1');

    clock.advance(TTL_MS - 1);

    await expect(tokens.resolve(token)).resolves.toBe('user-1');
  });

  it('revokes on demand, idempotently', async () => {
    const { tokens } = build();
    const token = await tokens.issue('user-1');

    await tokens.revoke(token);
    await tokens.revoke(token);

    await expect(tokens.resolve(token)).resolves.toBeNull();
  });

  it('sweeps expired sessions as new ones are issued, so memory cannot grow without bound', async () => {
    const { clock, tokens } = build();
    const stale = await Promise.all(Array.from({ length: 5 }, () => tokens.issue('user-1')));

    clock.advance(TTL_MS + 1);
    await tokens.issue('user-2');

    const resolutions = await Promise.all(stale.map((token) => tokens.resolve(token)));
    expect(resolutions).toEqual([null, null, null, null, null]);
  });
});

describe('InMemoryUserRepository', () => {
  it('finds a player by id and by username, case-insensitively', async () => {
    const repository = new InMemoryUserRepository();
    await repository.create(person('user-1', 'Alice'));

    await expect(repository.findById('user-1')).resolves.toMatchObject({ username: 'Alice' });
    await expect(repository.findByUsername('alice')).resolves.toMatchObject({ id: 'user-1' });
    await expect(repository.findByUsername('  ALICE ')).resolves.toMatchObject({ id: 'user-1' });
  });

  it('returns null rather than throwing for an unknown player', async () => {
    const repository = new InMemoryUserRepository();

    await expect(repository.findById('nobody')).resolves.toBeNull();
    await expect(repository.findByUsername('nobody')).resolves.toBeNull();
  });

  it('enforces username uniqueness at the store, not in the caller', async () => {
    const repository = new InMemoryUserRepository();
    await repository.create(person('user-1', 'Alice'));

    await expect(repository.create(person('user-2', 'alice'))).rejects.toThrow(UsernameTakenError);
  });

  it('counts wins', async () => {
    const repository = new InMemoryUserRepository();
    await repository.create(person('user-1', 'Alice'));

    await repository.recordWin('user-1');
    const updated = await repository.recordWin('user-1');

    expect(updated?.wins).toBe(2);
  });

  it('reports a win for a vanished player rather than resurrecting one', async () => {
    const repository = new InMemoryUserRepository();

    await expect(repository.recordWin('nobody')).resolves.toBeNull();
  });

  it('isolates callers from the stored record', async () => {
    const repository = new InMemoryUserRepository();
    const created = await repository.create(person('user-1', 'Alice'));

    (created as { wins: number }).wins = 999;

    await expect(repository.findById('user-1')).resolves.toMatchObject({ wins: 0 });
  });
});
