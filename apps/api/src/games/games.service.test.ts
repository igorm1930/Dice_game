import { gameViewSchema, type GameView } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../common/errors/api-error';
import { type RequestUser } from '../common/http/request-context';
import { applyHold, applyRoll, createGame, type GameState } from '../domain/game';
import { standardRulesV1 } from '../domain/rules/standard-v1';
import { DeterministicDiceGenerator } from './adapters/deterministic-dice.generator';
import { InMemoryGameRepository } from './adapters/in-memory-game.repository';
import { type Clock } from './ports/clock.port';
import { type GameRepository, type PersistedGame } from './ports/game-repository.port';
import { type IdGenerator } from './ports/id-generator.port';
import { GamesService, type UserLookup } from './games.service';

/**
 * The service is an orchestrator, so these test orchestration: that it loads,
 * resolves, delegates to the domain and persists under the revision guard — and
 * that it decides nothing on its own.
 *
 * Where a transition's *result* is the subject, the expectation is computed by
 * calling the domain transition directly and comparing. That is deliberate: an
 * expectation of `roundScore: 7` would put the ruleset's arithmetic in this
 * file, which is precisely the duplication the layering exists to prevent. If
 * the service ever stopped delegating, these fail; if a rule changes, they do
 * not.
 *
 * All doubles are hand-written — no mocking framework anywhere in this
 * repository. The repository and the dice are the real adapters, because the
 * behaviour under test (compare-and-set, a scripted throw) is theirs.
 */

const ADA: RequestUser = {
  id: '507f1f77bcf86cd799439012',
  email: 'ada@example.test',
  displayName: 'Ada',
};

const GRACE: RequestUser = {
  id: '507f1f77bcf86cd799439013',
  email: 'grace@example.test',
  displayName: 'Grace',
};

const CAROL: RequestUser = {
  id: '507f1f77bcf86cd799439014',
  email: 'carol@example.test',
  displayName: 'Carol',
};

const UNKNOWN_ID = '507f1f77bcf86cd7994390ff';

/** The single scripted throw. One entry, cycled, so every roll is identical. */
const SCRIPTED_THROW = [3, 4] as const;

/**
 * The stored user, derived from the port's own signature rather than imported
 * from the auth module's entity file.
 *
 * The games module depends on the *token and the interface* and on nothing
 * else; deriving the record type from `findById` keeps that true here too. The
 * fields below are filled in only so the double satisfies the port — this module
 * reads exactly one of them.
 */
type FoundUser = NonNullable<Awaited<ReturnType<UserLookup['findById']>>>;

function userRecord(user: RequestUser): FoundUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    passwordHash: 'not-a-real-hash',
    tokenVersion: 0,
    createdAt: new Date('2026-07-28T09:00:00.000Z'),
  };
}

class FakeUserRepository implements UserLookup {
  private readonly users = new Map<string, FoundUser>();

  seed(...users: readonly RequestUser[]): this {
    for (const user of users) {
      this.users.set(user.id, userRecord(user));
    }

    return this;
  }

  findById(id: string): Promise<FoundUser | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }
}

class SequentialIdGenerator implements IdGenerator {
  private next = 1;

  nextId(): string {
    const id = this.next.toString(16).padStart(24, '0');
    this.next += 1;

    return id;
  }
}

class FixedClock implements Clock {
  private current = new Date('2026-07-28T10:00:00.000Z');

  now(): Date {
    this.current = new Date(this.current.getTime() + 1000);

    return this.current;
  }
}

/**
 * A repository that holds every reader at the door until `parties` of them have
 * arrived, then lets them all through at once.
 *
 * This is what makes the concurrency test a *real* race rather than two
 * sequential calls: both requests observe the same revision, both run the
 * transition, and only then do they contend on the compare-and-set. Without the
 * barrier the second call would simply read the first one's result and the test
 * would prove nothing.
 */
class BarrierGameRepository implements GameRepository {
  private arrived = 0;
  private open!: () => void;
  private readonly gate: Promise<void>;

  constructor(
    private readonly inner: GameRepository,
    private readonly parties: number,
  ) {
    this.gate = new Promise<void>((resolve) => {
      this.open = resolve;
    });
  }

  async findById(gameId: string): Promise<PersistedGame | null> {
    const game = await this.inner.findById(gameId);

    this.arrived += 1;

    if (this.arrived >= this.parties) {
      this.open();
    } else {
      await this.gate;
    }

    return game;
  }

  create(state: GameState): Promise<PersistedGame> {
    return this.inner.create(state);
  }

  updateIfRevisionMatches(
    gameId: string,
    expectedRevision: number,
    next: GameState,
  ): Promise<PersistedGame | null> {
    return this.inner.updateIfRevisionMatches(gameId, expectedRevision, next);
  }
}

/**
 * A repository that parks one reader mid-flight, so a second request can land
 * underneath it.
 *
 * `BarrierGameRepository` above makes two requests contend at the *same*
 * revision. This one makes them contend at *different* ones, which is the case
 * that matters when the revision guarding the write is supplied by the client
 * rather than read from the document. The held reader has already loaded its
 * state; whatever is released afterwards writes on top of a document that has
 * since moved.
 */
class GatedGameRepository implements GameRepository {
  private reads = 0;
  private release!: () => void;
  private arrive!: () => void;

  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  /** Resolves once the held reader has loaded and parked. */
  readonly parked = new Promise<void>((resolve) => {
    this.arrive = resolve;
  });

  constructor(
    private readonly inner: GameRepository,
    private readonly holdRead: number,
  ) {}

  async findById(gameId: string): Promise<PersistedGame | null> {
    const game = await this.inner.findById(gameId);

    this.reads += 1;

    if (this.reads === this.holdRead) {
      this.arrive();
      await this.gate;
    }

    return game;
  }

  letGo(): void {
    this.release();
  }

  create(state: GameState): Promise<PersistedGame> {
    return this.inner.create(state);
  }

  updateIfRevisionMatches(
    gameId: string,
    expectedRevision: number,
    next: GameState,
  ): Promise<PersistedGame | null> {
    return this.inner.updateIfRevisionMatches(gameId, expectedRevision, next);
  }
}

interface Harness {
  readonly service: GamesService;
  readonly repository: InMemoryGameRepository;
  readonly dice: DeterministicDiceGenerator;
  readonly users: FakeUserRepository;
}

function harness(repositoryFor?: (inner: InMemoryGameRepository) => GameRepository): Harness {
  const repository = new InMemoryGameRepository(new FixedClock());
  const dice = new DeterministicDiceGenerator([[...SCRIPTED_THROW]]);
  const users = new FakeUserRepository().seed(ADA, GRACE, CAROL);

  return {
    service: new GamesService(
      repositoryFor === undefined ? repository : repositoryFor(repository),
      users,
      dice,
      new SequentialIdGenerator(),
    ),
    repository,
    dice,
    users,
  };
}

/** Puts a game straight into the store, bypassing the service. */
function seed(repository: InMemoryGameRepository, state: GameState): Promise<PersistedGame> {
  return repository.create(state);
}

function newMatch(id: string, winningScore?: number): GameState {
  return createGame({
    id,
    players: [
      { userId: ADA.id, displayName: ADA.displayName },
      { userId: GRACE.id, displayName: GRACE.displayName },
    ],
    winningScore,
  });
}

const GAME_ID = '507f1f77bcf86cd799439011';

describe('create', () => {
  it('seats the creator first and the named opponent second', async () => {
    const { service } = harness();

    const view = await service.create(ADA, { opponentId: GRACE.id });

    expect(view.players).toEqual([
      { userId: ADA.id, displayName: 'Ada', globalScore: 0, winCount: 0 },
      { userId: GRACE.id, displayName: 'Grace', globalScore: 0, winCount: 0 },
    ]);
    expect(view.viewerSeat).toBe(0);
  });

  it('returns a view the contract accepts', async () => {
    const { service } = harness();

    const view = await service.create(ADA, { opponentId: GRACE.id });

    expect(gameViewSchema.safeParse(view)).toMatchObject({ success: true });
  });

  it('starts at game one, revision zero, with nobody having rolled', async () => {
    const { service } = harness();

    expect(await service.create(ADA, { opponentId: GRACE.id })).toMatchObject({
      gameNumber: 1,
      revision: 0,
      roundScore: 0,
      lastDice: null,
      status: 'ACTIVE',
      winner: null,
      effect: null,
    });
  });

  it('takes the id from the generator port', async () => {
    const { service } = harness();

    expect((await service.create(ADA, { opponentId: GRACE.id })).id).toBe(
      '000000000000000000000001',
    );
  });

  it('persists the game so it can be read back', async () => {
    const { service, repository } = harness();

    const view = await service.create(ADA, { opponentId: GRACE.id });

    expect(await repository.findById(view.id)).not.toBeNull();
  });

  it('defaults the winning score to the ruleset default', async () => {
    const { service } = harness();

    expect((await service.create(ADA, { opponentId: GRACE.id })).winningScore).toBe(
      standardRulesV1.defaultWinningScore,
    );
  });

  it('honours an explicit winning score', async () => {
    const { service } = harness();

    expect(
      (await service.create(ADA, { opponentId: GRACE.id, winningScore: 42 })).winningScore,
    ).toBe(42);
  });

  it('refuses an opponent nobody has heard of', async () => {
    const { service } = harness();

    await expect(service.create(ADA, { opponentId: UNKNOWN_ID })).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('persists nothing when the opponent is unknown', async () => {
    const { service, repository } = harness();

    await expect(service.create(ADA, { opponentId: UNKNOWN_ID })).rejects.toBeInstanceOf(ApiError);
    expect(await repository.findById('000000000000000000000001')).toBeNull();
  });

  it('refuses a match against yourself', async () => {
    const { service } = harness();

    await expect(service.create(ADA, { opponentId: ADA.id })).rejects.toMatchObject({
      code: 'INVALID_OPPONENT',
    });
  });

  it('refuses a winning score outside the ruleset bounds', async () => {
    const { service } = harness();

    await expect(
      service.create(ADA, {
        opponentId: GRACE.id,
        winningScore: standardRulesV1.maximumWinningScore + 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET_SCORE' });
  });
});

describe('findForViewer', () => {
  it('shows a player the board, from their own seat', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    expect(await service.findForViewer(GRACE, GAME_ID)).toMatchObject({
      id: GAME_ID,
      viewerSeat: 1,
    });
  });

  it('refuses to show the board to somebody who is not playing', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(service.findForViewer(CAROL, GAME_ID)).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });

  it('does not leak a single field of a match the caller is not in', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    const outcome: GameView | { readonly failed: true } = await service
      .findForViewer(CAROL, GAME_ID)
      .catch(() => ({ failed: true }) as const);

    expect(outcome).toEqual({ failed: true });
  });

  it('answers not-found for an id nobody has used', async () => {
    const { service } = harness();

    await expect(service.findForViewer(ADA, UNKNOWN_ID)).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });
});

describe('roll', () => {
  it('applies exactly what the domain transition would', async () => {
    const { service, repository } = harness();
    const seeded = await seed(repository, newMatch(GAME_ID));

    const view = await service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision });

    // The expectation is the domain's own answer, so this asserts delegation
    // rather than restating a rule.
    const expected = applyRoll(seeded, ADA.id, [...SCRIPTED_THROW], standardRulesV1);

    expect(view).toMatchObject({
      roundScore: expected.roundScore,
      activePlayer: expected.activePlayer,
      effect: expected.effect,
      lastDice: [...SCRIPTED_THROW],
    });
  });

  it('lets the repository move the revision, and moves it by exactly one', async () => {
    const { service, repository } = harness();
    const seeded = await seed(repository, newMatch(GAME_ID));

    const view = await service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision });

    expect(view.revision).toBe(seeded.revision + 1);
  });

  it('draws its dice from the port rather than inventing them', async () => {
    const { service, repository, dice } = harness();
    await seed(repository, newMatch(GAME_ID));

    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });

    expect(dice.throwCount).toBe(1);
  });

  it('refuses a player acting out of turn', async () => {
    const { service, repository } = harness();
    const seeded = await seed(repository, newMatch(GAME_ID));
    // A hold passes the dice without naming a losing combination.
    await service.hold(ADA, GAME_ID, { expectedRevision: seeded.revision });

    await expect(service.roll(ADA, GAME_ID, { expectedRevision: 1 })).rejects.toMatchObject({
      code: 'NOT_YOUR_TURN',
    });
  });

  it('refuses somebody who is not in the match', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(service.roll(CAROL, GAME_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });

  it('refuses to play a match that has already been won', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID, standardRulesV1.minimumWinningScore));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });
    await service.hold(ADA, GAME_ID, { expectedRevision: 1 });

    await expect(service.roll(ADA, GAME_ID, { expectedRevision: 2 })).rejects.toMatchObject({
      code: 'GAME_OVER',
    });
  });

  it('answers not-found for a game that does not exist', async () => {
    const { service } = harness();

    await expect(service.roll(ADA, UNKNOWN_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'GAME_NOT_FOUND',
    });
  });
});

describe('hold', () => {
  it('banks exactly what the domain transition would', async () => {
    const { service, repository } = harness();
    const seeded = await seed(repository, newMatch(GAME_ID));
    await service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision });

    const rolled = await repository.findById(GAME_ID);
    const view = await service.hold(ADA, GAME_ID, { expectedRevision: 1 });
    const expected = applyHold(rolled!, ADA.id, standardRulesV1);

    expect(view).toMatchObject({
      roundScore: expected.roundScore,
      activePlayer: expected.activePlayer,
      effect: expected.effect,
      players: [
        expect.objectContaining({ globalScore: expected.players[0].globalScore }),
        expect.objectContaining({ globalScore: expected.players[1].globalScore }),
      ],
    });
  });

  it('completes the match when the bank wins it', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID, standardRulesV1.minimumWinningScore));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });

    const view = await service.hold(ADA, GAME_ID, { expectedRevision: 1 });

    expect(view).toMatchObject({ status: 'COMPLETED', winner: 0, effect: 'GAME_WON' });
    expect(view.players[0].winCount).toBe(1);
    expect(view.availableActions).toMatchObject({ canRoll: false, canHold: false });
  });

  it('refuses somebody who is not in the match', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(service.hold(CAROL, GAME_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });
});

describe('newGame', () => {
  it('starts the next game in the series, preserving win counts', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID, standardRulesV1.minimumWinningScore));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });
    await service.hold(ADA, GAME_ID, { expectedRevision: 1 });

    const view = await service.newGame(ADA, GAME_ID, { expectedRevision: 2 });

    expect(view).toMatchObject({
      gameNumber: 2,
      status: 'ACTIVE',
      winner: null,
      roundScore: 0,
      lastDice: null,
      activePlayer: 0,
      effect: 'NEW_GAME',
    });
    expect(view.players.map((player) => player.winCount)).toEqual([1, 0]);
    expect(view.players.map((player) => player.globalScore)).toEqual([0, 0]);
  });

  it('is legal mid-game', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });

    expect(await service.newGame(ADA, GAME_ID, { expectedRevision: 1 })).toMatchObject({
      gameNumber: 2,
      roundScore: 0,
    });
  });

  it('is legal for the player whose turn it is not', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    expect(await service.newGame(GRACE, GAME_ID, { expectedRevision: 0 })).toMatchObject({
      gameNumber: 2,
    });
  });

  it('may change the winning score for the new game', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID, 100));

    expect(
      await service.newGame(ADA, GAME_ID, { expectedRevision: 0, winningScore: 30 }),
    ).toMatchObject({ winningScore: 30 });
  });

  it('refuses a winning score outside the ruleset bounds', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(
      service.newGame(ADA, GAME_ID, {
        expectedRevision: 0,
        winningScore: standardRulesV1.minimumWinningScore - 1,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_TARGET_SCORE' });
  });

  it('refuses somebody who is not in the match', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(service.newGame(CAROL, GAME_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });
});

describe('optimistic concurrency', () => {
  it('refuses a write whose revision has already moved on', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });

    await expect(service.roll(ADA, GAME_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'GAME_REVISION_CONFLICT',
    });
  });

  it('reports the conflict with the revision the caller believed in', async () => {
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));
    await service.roll(ADA, GAME_ID, { expectedRevision: 0 });

    await expect(service.roll(ADA, GAME_ID, { expectedRevision: 0 })).rejects.toMatchObject({
      details: { gameId: GAME_ID, expectedRevision: 0 },
    });
  });

  it('applies exactly one of two rolls issued at the same revision', async () => {
    const { service, repository, dice } = harness((real) => new BarrierGameRepository(real, 2));
    const seeded = await seed(repository, newMatch(GAME_ID));

    // Both calls load before either writes — a genuine race, not two sequential
    // requests. The barrier is what makes that true rather than hoped for.
    const outcomes = await Promise.allSettled([
      service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision }),
      service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision }),
    ]);

    const applied = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

    expect(applied).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ reason: { code: 'GAME_REVISION_CONFLICT' } });

    // Both attempts really ran the transition; one of them was discarded rather
    // than short-circuited, which is what makes the conflict a real one.
    expect(dice.throwCount).toBe(2);

    // And exactly one roll landed: one revision, one roll's worth of points, and
    // no replay of the refused action.
    const stored = await repository.findById(GAME_ID);
    const oneRoll = applyRoll(seeded, ADA.id, [...SCRIPTED_THROW], standardRulesV1);

    expect(stored?.revision).toBe(seeded.revision + 1);
    expect(stored?.roundScore).toBe(oneRoll.roundScore);
    expect(stored?.lastDice).toEqual([...SCRIPTED_THROW]);
  });

  it('refuses a write whose expectedRevision is not the revision it was computed from', async () => {
    // The compare-and-set guards on a number the *client* chose, while the state
    // being written is computed from whatever the server happened to load. If
    // those two are allowed to differ, a client can aim a write at a revision
    // that does not exist yet and have it land once somebody else creates it —
    // overwriting their move with one computed from before it.
    //
    // Reads: 1 = the opening roll, 2 = the stale roll (held), 3 = the hold.
    let gated!: GatedGameRepository;
    const { service, repository } = harness((real) => {
      gated = new GatedGameRepository(real, 2);

      return gated;
    });

    const seeded = await seed(repository, newMatch(GAME_ID));

    await service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision });

    const onTheTable = await repository.findById(GAME_ID);

    // Aimed one revision into the future. It loads the game as it is now, then
    // parks before writing.
    const stale = service.roll(ADA, GAME_ID, { expectedRevision: 2 });

    await gated.parked;

    // Meanwhile Ada banks. This is the move that must survive.
    await service.hold(ADA, GAME_ID, { expectedRevision: 1 });

    const banked = await repository.findById(GAME_ID);

    expect(banked?.revision).toBe(2);
    expect(banked?.players[0].globalScore).toBe(onTheTable?.roundScore);
    expect(banked?.activePlayer).toBe(1);

    gated.letGo();

    await expect(stale).rejects.toMatchObject({ code: 'GAME_REVISION_CONFLICT' });

    // And the bank is still there: same banked total, still Grace to play.
    const after = await repository.findById(GAME_ID);

    expect(after?.players[0].globalScore).toBe(onTheTable?.roundScore);
    expect(after?.activePlayer).toBe(1);
    expect(after?.roundScore).toBe(0);
  });

  it('tells a stranger they are not in the match, not that the revision moved', async () => {
    // Both refusals are available here — Carol is not a participant *and* her
    // revision is wrong — so this is the fixture where the ordering is visible.
    // With `expectedRevision: 0` the two answers agree and the test proves
    // nothing; the revision check has to sit after the transition, or a stranger
    // probing an id they guessed learns that the game exists and is being
    // played.
    const { service, repository } = harness();
    await seed(repository, newMatch(GAME_ID));

    await expect(service.roll(CAROL, GAME_ID, { expectedRevision: 99 })).rejects.toMatchObject({
      code: 'NOT_A_PARTICIPANT',
    });
  });

  it('does not replay the refused action afterwards', async () => {
    const { service, repository } = harness((real) => new BarrierGameRepository(real, 2));
    const seeded = await seed(repository, newMatch(GAME_ID));

    await Promise.allSettled([
      service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision }),
      service.roll(ADA, GAME_ID, { expectedRevision: seeded.revision }),
    ]);

    expect((await repository.findById(GAME_ID))?.revision).toBe(1);
  });
});
