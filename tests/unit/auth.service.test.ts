import {
  InvalidCredentialsError,
  UnauthenticatedError,
  UserNotFoundError,
  UsernameTakenError,
} from '../../src/core/domain/user';
import { AuthService } from '../../src/core/services/auth.service';
import { InMemoryAuthTokenService } from '../../src/infrastructure/auth/in-memory-auth-token.service';
import { InMemoryUserRepository } from '../../src/infrastructure/persistence/in-memory-user.repository';
import { FakePasswordHasher, FixedClock, SequentialIdGenerator } from '../support/fakes';

const TTL_MS = 60_000;

interface Harness {
  readonly service: AuthService;
  readonly users: InMemoryUserRepository;
  readonly tokens: InMemoryAuthTokenService;
  readonly clock: FixedClock;
}

function build(): Harness {
  const clock = new FixedClock();
  const users = new InMemoryUserRepository();
  const tokens = new InMemoryAuthTokenService({ clock, ttlMs: TTL_MS });

  const service = new AuthService({
    users,
    hasher: new FakePasswordHasher(),
    tokens,
    idGenerator: new SequentialIdGenerator(),
    clock,
  });

  return { service, users, tokens, clock };
}

describe('AuthService', () => {
  describe('register', () => {
    it('creates the player and returns a usable session', async () => {
      const { service } = build();

      const session = await service.register('alice', 'correct horse battery');

      expect(session.player).toEqual({
        id: '00000000-0000-4000-8000-000000000001',
        username: 'alice',
        wins: 0,
      });
      expect(session.token).toEqual(expect.any(String));
      await expect(service.authenticate(session.token)).resolves.toMatchObject({
        username: 'alice',
      });
    });

    it('never stores the password itself', async () => {
      const { service, users } = build();
      await service.register('alice', 'correct horse battery');

      const stored = await users.findByUsername('alice');

      expect(stored?.passwordHash).not.toContain('correct horse battery');
    });

    it('rejects a username already taken, case-insensitively', async () => {
      const { service } = build();
      await service.register('alice', 'correct horse battery');

      await expect(service.register('ALICE', 'another password')).rejects.toThrow(
        UsernameTakenError,
      );
    });

    it('trims the username before storing it', async () => {
      const { service } = build();

      const session = await service.register('  alice  ', 'correct horse battery');

      expect(session.player.username).toBe('alice');
    });
  });

  describe('login', () => {
    it('issues a fresh session for the right password', async () => {
      const { service } = build();
      const registered = await service.register('alice', 'correct horse battery');

      const loggedIn = await service.login('alice', 'correct horse battery');

      expect(loggedIn.player.id).toBe(registered.player.id);
      expect(loggedIn.token).not.toBe(registered.token);
    });

    it('accepts any casing of the username', async () => {
      const { service } = build();
      await service.register('alice', 'correct horse battery');

      await expect(service.login('ALICE', 'correct horse battery')).resolves.toBeDefined();
    });

    it('rejects a wrong password', async () => {
      const { service } = build();
      await service.register('alice', 'correct horse battery');

      await expect(service.login('alice', 'wrong password!')).rejects.toThrow(
        InvalidCredentialsError,
      );
    });

    /**
     * The two failures must be indistinguishable, or the endpoint becomes an
     * account-enumeration oracle: an attacker learns which usernames exist
     * before guessing a single password.
     */
    it('reports an unknown user with exactly the same error as a wrong password', async () => {
      const { service } = build();
      await service.register('alice', 'correct horse battery');

      const wrongPassword = await service.login('alice', 'nope nope nope').catch((e: unknown) => e);
      const unknownUser = await service.login('mallory', 'nope nope nope').catch((e: unknown) => e);

      expect(wrongPassword).toBeInstanceOf(InvalidCredentialsError);
      expect(unknownUser).toBeInstanceOf(InvalidCredentialsError);
      expect((unknownUser as Error).message).toBe((wrongPassword as Error).message);
      expect((unknownUser as InvalidCredentialsError).details).toEqual(
        (wrongPassword as InvalidCredentialsError).details,
      );
    });

    it('still burns a hash verification for an unknown user, so timing does not leak either', async () => {
      const { users, tokens } = build();
      let verifications = 0;
      const counting = {
        hash: (plaintext: string) => Promise.resolve(`fake$${plaintext}`),
        verify: (): Promise<boolean> => {
          verifications += 1;
          return Promise.resolve(false);
        },
      };

      const counted = new AuthService({
        users,
        hasher: counting,
        tokens,
        idGenerator: new SequentialIdGenerator(),
        clock: new FixedClock(),
      });

      await expect(counted.login('nobody', 'nope nope nope')).rejects.toThrow(
        InvalidCredentialsError,
      );
      expect(verifications).toBe(1);
    });
  });

  describe('authenticate', () => {
    it('rejects an unknown token', async () => {
      const { service } = build();

      await expect(service.authenticate('not-a-real-token')).rejects.toThrow(UnauthenticatedError);
    });

    it('rejects an expired token', async () => {
      const { service, clock } = build();
      const session = await service.register('alice', 'correct horse battery');

      clock.advance(TTL_MS + 1);

      await expect(service.authenticate(session.token)).rejects.toThrow(UnauthenticatedError);
    });

    it('rejects a token whose player has disappeared', async () => {
      const { tokens, users } = build();
      const orphan = await tokens.issue('user-who-never-existed');

      const orphanService = new AuthService({
        users,
        hasher: new FakePasswordHasher(),
        tokens,
        idGenerator: new SequentialIdGenerator(),
        clock: new FixedClock(),
      });

      await expect(orphanService.authenticate(orphan)).rejects.toThrow(UnauthenticatedError);
      // …and the dead credential is revoked rather than left resolvable.
      await expect(tokens.resolve(orphan)).resolves.toBeNull();
    });

    it('reflects a win recorded after the session was issued', async () => {
      const { service, users } = build();
      const session = await service.register('alice', 'correct horse battery');
      await users.recordWin(session.player.id);

      await expect(service.authenticate(session.token)).resolves.toMatchObject({ wins: 1 });
    });
  });

  describe('logout', () => {
    it('makes the token unusable', async () => {
      const { service } = build();
      const session = await service.register('alice', 'correct horse battery');

      await service.logout(session.token);

      await expect(service.authenticate(session.token)).rejects.toThrow(UnauthenticatedError);
    });

    it('leaves the other seat signed in', async () => {
      const { service } = build();
      const alice = await service.register('alice', 'correct horse battery');
      const bob = await service.register('bob', 'correct horse battery');

      await service.logout(alice.token);

      await expect(service.authenticate(bob.token)).resolves.toMatchObject({ username: 'bob' });
    });
  });

  describe('requireByUsername', () => {
    it('resolves a registered opponent', async () => {
      const { service } = build();
      await service.register('bob', 'correct horse battery');

      await expect(service.requireByUsername('BOB')).resolves.toMatchObject({ username: 'bob' });
    });

    it('raises a distinct error for an opponent who has not signed up', async () => {
      const { service } = build();

      await expect(service.requireByUsername('ghost')).rejects.toThrow(UserNotFoundError);
    });
  });
});
