import { rollDice } from '../domain/dice';
import { GameNotFoundError } from '../domain/errors';
import { createGame, playRound, type Game, type Round } from '../domain/game';
import type { Clock } from '../ports/clock.port';
import type { GameRepository, Page, PageRequest } from '../ports/game-repository.port';
import type { IdGenerator } from '../ports/id-generator.port';
import type { KeyedLock } from '../ports/lock.port';
import type { RandomGenerator } from '../ports/random-generator.port';

export interface GameServiceConfig {
  readonly defaultRounds: number;
  readonly maxRounds: number;
}

export interface GameServiceDependencies {
  readonly repository: GameRepository;
  readonly random: RandomGenerator;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly lock: KeyedLock;
  readonly config: GameServiceConfig;
}

export interface CreateGameCommand {
  readonly playerName: string;
  readonly rounds?: number | undefined;
}

export interface RollResult {
  readonly game: Game;
  readonly round: Round;
}

/**
 * Application service for the Game aggregate.
 *
 * Orchestration only: it loads aggregates, calls pure domain functions, and
 * persists results. No scoring rule lives here — rules belong in
 * `core/domain/scoring.ts` where they can be tested without a repository.
 *
 * Every collaborator arrives through the constructor. There is no module-level
 * import of a concrete adapter anywhere in this file, which is what allows the
 * entire class to be unit tested with fakes and no I/O.
 */
export class GameService {
  private readonly repository: GameRepository;
  private readonly random: RandomGenerator;
  private readonly clock: Clock;
  private readonly idGenerator: IdGenerator;
  private readonly lock: KeyedLock;
  private readonly config: GameServiceConfig;

  constructor(dependencies: GameServiceDependencies) {
    this.repository = dependencies.repository;
    this.random = dependencies.random;
    this.clock = dependencies.clock;
    this.idGenerator = dependencies.idGenerator;
    this.lock = dependencies.lock;
    this.config = dependencies.config;
  }

  async createGame(command: CreateGameCommand): Promise<Game> {
    const game = createGame({
      id: this.idGenerator.generate(),
      playerName: command.playerName,
      totalRounds: command.rounds ?? this.config.defaultRounds,
      maxRounds: this.config.maxRounds,
      now: this.clock.now(),
    });

    return this.repository.create(game);
  }

  async getGame(id: string): Promise<Game> {
    const game = await this.repository.findById(id);

    if (!game) {
      throw new GameNotFoundError(id);
    }

    return game;
  }

  /**
   * Plays one round.
   *
   * The load → apply → save sequence spans `await` boundaries, so it is a
   * genuine critical section even on Node's single thread: without the lock,
   * two concurrent rolls for the same game would both read version N and both
   * write version N+1, and one round would be silently lost.
   *
   * Two independent defences are applied, deliberately:
   *   - the keyed lock serialises rolls per game, so the common case never
   *     conflicts and clients are never asked to retry;
   *   - the repository's version guard is a correctness backstop that turns any
   *     escape (a future multi-replica deployment, a bug in the lock) into a
   *     loud 409 rather than a lost update.
   */
  async rollDice(gameId: string): Promise<RollResult> {
    return this.lock.withLock(gameId, async () => {
      const current = await this.getGame(gameId);

      const dice = rollDice(this.random);
      const { game, round } = playRound(current, dice, this.clock.now());

      const persisted = await this.repository.update(game);

      return { game: persisted, round };
    });
  }

  async listGames(page: PageRequest): Promise<Page<Game>> {
    return this.repository.findAll(page);
  }

  async getLeaderboard(limit: number): Promise<readonly Game[]> {
    return this.repository.findLeaderboard(limit);
  }
}
