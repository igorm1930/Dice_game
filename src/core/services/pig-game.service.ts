import { rollDicePair } from '../domain/dice';
import {
  NoGameInProgressError,
  applyHold,
  applyRoll,
  createPigGame,
  requireTurn,
  seatOf,
  type PigGameState,
  type PigSeat,
} from '../domain/pig-game';
import { toPlayerIdentity, type PlayerIdentity, type User } from '../domain/user';
import type { KeyedLock } from '../ports/lock.port';
import type { PigGameRepository } from '../ports/pig-game-repository.port';
import type { RandomGenerator } from '../ports/random-generator.port';
import type { UserRepository } from '../ports/user-repository.port';

/**
 * All state transitions share one lock key: there is a single shared table, so
 * every mutation belongs to the same critical section.
 */
const LOCK_KEY = 'pig-game';

/**
 * A match plus the live identities of its two seats.
 *
 * Win totals are read fresh from the user store rather than copied into the
 * game, so the counter a player sees is their real all-time total and not a
 * value frozen when this match began.
 */
export interface PigGameView {
  readonly state: PigGameState;
  readonly players: readonly [PlayerIdentity, PlayerIdentity];
  /** The caller's seat, or `null` if they are watching someone else's game. */
  readonly viewerSeat: PigSeat | null;
}

export interface PigGameServiceConfig {
  /** Winning score used when NEW GAME does not name one. */
  readonly defaultTargetScore: number;
}

export interface PigGameServiceDependencies {
  readonly repository: PigGameRepository;
  readonly users: UserRepository;
  readonly random: RandomGenerator;
  readonly lock: KeyedLock;
  readonly config: PigGameServiceConfig;
}

export interface StartGameCommand {
  readonly creator: User;
  readonly opponent: User;
  readonly targetScore?: number | undefined;
}

/**
 * Application service for the Pig game — the single source of truth for the
 * rules and for whose turn it is.
 *
 * Roll and hold take no client input beyond the caller's identity: the dice are
 * generated here, the turn is checked against the authenticated user, and the
 * only client-supplied value in the whole game is the winning score chosen at
 * setup. There is no field a modified client could smuggle a rule into.
 *
 * roll/hold/newGame are read-modify-write sequences spanning awaits, so they
 * run under the keyed lock with the repository's version guard as backstop —
 * the same two-layer defence as the rounds game (ADR-0004).
 */
export class PigGameService {
  private readonly repository: PigGameRepository;
  private readonly users: UserRepository;
  private readonly random: RandomGenerator;
  private readonly lock: KeyedLock;
  private readonly config: PigGameServiceConfig;

  constructor(dependencies: PigGameServiceDependencies) {
    this.repository = dependencies.repository;
    this.users = dependencies.users;
    this.random = dependencies.random;
    this.lock = dependencies.lock;
    this.config = dependencies.config;
  }

  /** @throws {NoGameInProgressError} when no match has been started. */
  async getState(viewer: User): Promise<PigGameView> {
    return this.view(await this.requireState(), viewer);
  }

  async roll(actor: User): Promise<PigGameView> {
    const next = await this.lock.withLock(LOCK_KEY, async () => {
      const current = await this.requireState();

      // Authorise *before* drawing dice. `applyRoll` checks again — it must, it
      // is the domain — but a rejected request should not consume entropy, and
      // a scripted RNG in a test should not advance on a 403 either.
      requireTurn(current, actor.id, 'roll');

      return this.repository.save(applyRoll(current, actor.id, rollDicePair(this.random)));
    });

    return this.view(next, actor);
  }

  async hold(actor: User): Promise<PigGameView> {
    const next = await this.lock.withLock(LOCK_KEY, async () => {
      const current = await this.requireState();
      const held = await this.repository.save(applyHold(current, actor.id));

      // Extra #1: credit the win to the identity, not to the seat. Inside the
      // lock so a winning hold and its counter increment cannot interleave.
      if (held.winner !== null) {
        await this.users.recordWin(held.players[held.winner].id);
      }

      return held;
    });

    return this.view(next, actor);
  }

  /**
   * Starts a fresh match. A player may do this at any time, including while a
   * game is in progress — the requirement is explicit about that.
   */
  async newGame(command: StartGameCommand): Promise<PigGameView> {
    const next = await this.lock.withLock(LOCK_KEY, async () => {
      // The fresh state inherits the *current* version so the optimistic guard
      // still applies — a reset is a write like any other, not an exemption.
      const current = await this.repository.load();
      const fresh = createPigGame(
        [
          { id: command.creator.id, username: command.creator.username },
          { id: command.opponent.id, username: command.opponent.username },
        ],
        command.targetScore ?? this.config.defaultTargetScore,
      );

      return this.repository.save({ ...fresh, version: current?.version ?? 0 });
    });

    return this.view(next, command.creator);
  }

  private async requireState(): Promise<PigGameState> {
    const state = await this.repository.load();
    if (state === null) {
      throw new NoGameInProgressError();
    }
    return state;
  }

  private async view(state: PigGameState, viewer: User): Promise<PigGameView> {
    const [first, second] = await Promise.all([this.identity(state, 0), this.identity(state, 1)]);

    return { state, players: [first, second], viewerSeat: seatOf(state, viewer.id) };
  }

  /**
   * Live identity for a seat, falling back to the name recorded in the match if
   * the player record has since vanished — a scoreboard must still render.
   */
  private async identity(state: PigGameState, seat: PigSeat): Promise<PlayerIdentity> {
    const seated = state.players[seat];
    const user = await this.users.findById(seated.id);

    return user ? toPlayerIdentity(user) : { id: seated.id, username: seated.username, wins: 0 };
  }
}
