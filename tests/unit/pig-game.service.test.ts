import {
  NoGameInProgressError,
  NotAParticipantError,
  NotYourTurnError,
  PigGameOverError,
} from '../../src/core/domain/pig-game';
import type { User } from '../../src/core/domain/user';
import type { UserRepository } from '../../src/core/ports/user-repository.port';
import { PigGameService } from '../../src/core/services/pig-game.service';
import { AsyncMutex } from '../../src/infrastructure/concurrency/async-mutex';
import { InMemoryPigGameRepository } from '../../src/infrastructure/persistence/in-memory-pig-game.repository';
import { InMemoryUserRepository } from '../../src/infrastructure/persistence/in-memory-user.repository';
import { ScriptedRandomGenerator } from '../support/fakes';

interface Harness {
  readonly service: PigGameService;
  readonly users: InMemoryUserRepository;
  readonly alice: User;
  readonly bob: User;
  readonly carol: User;
}

function person(id: string, username: string): User {
  return {
    id,
    username,
    usernameKey: username,
    passwordHash: 'irrelevant',
    wins: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

async function harness(sequence: readonly number[], defaultTargetScore = 100): Promise<Harness> {
  const users = new InMemoryUserRepository();
  const [alice, bob, carol] = await Promise.all([
    users.create(person('user-alice', 'alice')),
    users.create(person('user-bob', 'bob')),
    users.create(person('user-carol', 'carol')),
  ]);

  const service = new PigGameService({
    repository: new InMemoryPigGameRepository(),
    users,
    random: new ScriptedRandomGenerator(sequence),
    lock: new AsyncMutex(),
    config: { defaultTargetScore },
  });

  return { service, users, alice: alice, bob: bob, carol: carol };
}

describe('PigGameService', () => {
  describe('before a game exists', () => {
    it('reports that there is no match rather than inventing one', async () => {
      const { service, alice } = await harness([3]);

      await expect(service.getState(alice)).rejects.toThrow(NoGameInProgressError);
      await expect(service.roll(alice)).rejects.toThrow(NoGameInProgressError);
      await expect(service.hold(alice)).rejects.toThrow(NoGameInProgressError);
    });
  });

  describe('newGame', () => {
    it('seats the creator first and the named opponent second', async () => {
      const { service, alice, bob } = await harness([3]);

      const view = await service.newGame({ creator: alice, opponent: bob });

      expect(view.state.players).toEqual([
        { id: alice.id, username: 'alice' },
        { id: bob.id, username: 'bob' },
      ]);
      expect(view.viewerSeat).toBe(0);
      expect(view.state.targetScore).toBe(100);
    });

    it('uses the configured default when no winning score is named', async () => {
      const { service, alice, bob } = await harness([3], 42);

      const view = await service.newGame({ creator: alice, opponent: bob });

      expect(view.state.targetScore).toBe(42);
    });

    it('honours an explicit winning score', async () => {
      const { service, alice, bob } = await harness([3]);

      const view = await service.newGame({ creator: alice, opponent: bob, targetScore: 25 });

      expect(view.state.targetScore).toBe(25);
    });

    it('may be started at any time, wiping a match already in progress', async () => {
      const { service, alice, bob } = await harness([5]);
      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);

      const restarted = await service.newGame({ creator: bob, opponent: alice });

      expect(restarted.state).toMatchObject({
        totalScores: [0, 0],
        currentTurnScore: 0,
        lastRoll: null,
        activePlayer: 0,
      });
      // Seats follow the new creator, so "start a new game" is not "swap sides".
      expect(restarted.state.players[0].id).toBe(bob.id);
    });
  });

  describe('roll', () => {
    it('throws two dice and banks their sum into the round score', async () => {
      const { service, alice, bob } = await harness([4, 3]);
      await service.newGame({ creator: alice, opponent: bob });

      const view = await service.roll(alice);

      expect(view.state.lastRoll).toEqual([4, 3]);
      expect(view.state.currentTurnScore).toBe(7);
    });

    it('consumes exactly two random values per roll', async () => {
      const random = new ScriptedRandomGenerator([2, 5, 1, 1]);
      const users = new InMemoryUserRepository();
      const alice = await users.create(person('user-alice', 'alice'));
      const bob = await users.create(person('user-bob', 'bob'));
      const service = new PigGameService({
        repository: new InMemoryPigGameRepository(),
        users,
        random,
        lock: new AsyncMutex(),
        config: { defaultTargetScore: 100 },
      });

      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);

      expect(random.callCount).toBe(2);
    });

    it('refuses a roll from the player whose turn it is not', async () => {
      const { service, alice, bob } = await harness([3]);
      await service.newGame({ creator: alice, opponent: bob });

      await expect(service.roll(bob)).rejects.toThrow(NotYourTurnError);
    });

    it('refuses a roll from someone who is not in the game', async () => {
      const { service, alice, bob, carol } = await harness([3]);
      await service.newGame({ creator: alice, opponent: bob });

      await expect(service.roll(carol)).rejects.toThrow(NotAParticipantError);
    });
  });

  describe('hold', () => {
    it('banks the round score and hands over', async () => {
      const { service, alice, bob } = await harness([4, 4]);
      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);

      const view = await service.hold(alice);

      expect(view.state).toMatchObject({ totalScores: [8, 0], activePlayer: 1 });
    });

    it('credits a win to the winning identity, not the seat', async () => {
      const { service, users, alice, bob } = await harness([5, 5], 10);
      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);

      const view = await service.hold(alice);

      expect(view.state.winner).toBe(0);
      expect(view.players[0].wins).toBe(1);
      await expect(users.findById(alice.id)).resolves.toMatchObject({ wins: 1 });
      await expect(users.findById(bob.id)).resolves.toMatchObject({ wins: 0 });
    });

    it('does not credit a win for an ordinary hold', async () => {
      const { service, users, alice, bob } = await harness([2, 2]);
      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);
      await service.hold(alice);

      await expect(users.findById(alice.id)).resolves.toMatchObject({ wins: 0 });
    });

    it('refuses any further action once the game is won', async () => {
      const { service, alice, bob } = await harness([5, 5], 10);
      await service.newGame({ creator: alice, opponent: bob });
      await service.roll(alice);
      await service.hold(alice);

      await expect(service.roll(alice)).rejects.toThrow(PigGameOverError);
      await expect(service.hold(bob)).rejects.toThrow(PigGameOverError);
    });
  });

  describe('the view it returns', () => {
    it('reports live win totals rather than a snapshot taken at kickoff', async () => {
      const { service, users, alice, bob } = await harness([1, 1]);
      await service.newGame({ creator: alice, opponent: bob });
      await users.recordWin(bob.id);

      const view = await service.getState(alice);

      expect(view.players[1].wins).toBe(1);
    });

    it('tells a spectator they hold no seat', async () => {
      const { service, alice, bob, carol } = await harness([1, 1]);
      await service.newGame({ creator: alice, opponent: bob });

      await expect(service.getState(carol)).resolves.toMatchObject({ viewerSeat: null });
    });

    it('falls back to the name recorded in the match if a player record vanishes', async () => {
      const alice = person('user-alice', 'alice');
      const bob = person('user-bob', 'bob');

      // A user store that has forgotten both players still has to render a
      // scoreboard rather than fail the request.
      const amnesiac: UserRepository = {
        create: (user) => Promise.resolve(user),
        findByUsername: () => Promise.resolve(null),
        findById: () => Promise.resolve(null),
        recordWin: () => Promise.resolve(null),
      };

      const service = new PigGameService({
        repository: new InMemoryPigGameRepository(),
        users: amnesiac,
        random: new ScriptedRandomGenerator([1, 1]),
        lock: new AsyncMutex(),
        config: { defaultTargetScore: 100 },
      });

      const view = await service.newGame({ creator: alice, opponent: bob });

      expect(view.players).toEqual([
        { id: alice.id, username: 'alice', wins: 0 },
        { id: bob.id, username: 'bob', wins: 0 },
      ]);
    });
  });

  describe('concurrency', () => {
    /**
     * Node's single thread does not make read-modify-write atomic: every
     * `await` is a yield point. Without the keyed lock these interleave and
     * rolls are silently lost (ADR-0004).
     */
    it('loses no rolls when the same player fires five at once', async () => {
      const { service, alice, bob } = await harness([1, 1]);
      await service.newGame({ creator: alice, opponent: bob });

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.roll(alice)),
      );

      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const view = await service.getState(alice);
      expect(view.state.currentTurnScore).toBe(10);
    });

    it('serialises a race between the two players so only the active one lands', async () => {
      const { service, alice, bob } = await harness([1, 1]);
      await service.newGame({ creator: alice, opponent: bob });

      const [aliceResult, bobResult] = await Promise.allSettled([
        service.roll(alice),
        service.roll(bob),
      ]);

      expect(aliceResult.status).toBe('fulfilled');
      expect(bobResult.status).toBe('rejected');
    });
  });
});
