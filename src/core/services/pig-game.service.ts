import { rollSingleDie } from '../domain/dice';
import { applyHold, applyRoll, createPigGame, type PigGameState } from '../domain/pig-game';
import type { KeyedLock } from '../ports/lock.port';
import type { PigGameRepository } from '../ports/pig-game-repository.port';
import type { RandomGenerator } from '../ports/random-generator.port';

/**
 * All state transitions share one lock key: the Pig game is a single shared
 * aggregate, so every mutation belongs to the same critical section.
 */
const LOCK_KEY = 'pig-game';

export interface PigGameServiceConfig {
  /** Target used when a new game does not specify one. */
  readonly defaultTargetScore: number;
}

export interface PigGameServiceDependencies {
  readonly repository: PigGameRepository;
  readonly random: RandomGenerator;
  readonly lock: KeyedLock;
  readonly config: PigGameServiceConfig;
}

/**
 * Application service for the Pig game — the single source of truth for the
 * rules. Roll and hold accept no client input at all; the only client-supplied
 * value in the whole game is the target score at game creation, validated by
 * the domain and frozen for the match.
 *
 * roll/hold/newGame are read-modify-write sequences spanning awaits, so they
 * run under the keyed lock with the repository's version guard as backstop —
 * the same two-layer defence as the rounds game (ADR-0004).
 */
export class PigGameService {
  private readonly repository: PigGameRepository;
  private readonly random: RandomGenerator;
  private readonly lock: KeyedLock;
  private readonly config: PigGameServiceConfig;

  constructor(dependencies: PigGameServiceDependencies) {
    this.repository = dependencies.repository;
    this.random = dependencies.random;
    this.lock = dependencies.lock;
    this.config = dependencies.config;
  }

  async getState(): Promise<PigGameState> {
    return this.repository.load();
  }

  async roll(): Promise<PigGameState> {
    return this.lock.withLock(LOCK_KEY, async () => {
      const current = await this.repository.load();
      const next = applyRoll(current, rollSingleDie(this.random));
      return this.repository.save(next);
    });
  }

  async hold(): Promise<PigGameState> {
    return this.lock.withLock(LOCK_KEY, async () => {
      const current = await this.repository.load();
      return this.repository.save(applyHold(current));
    });
  }

  async newGame(targetScore?: number): Promise<PigGameState> {
    return this.lock.withLock(LOCK_KEY, async () => {
      // The fresh state carries the *current* version so the optimistic guard
      // still applies — a reset is a write like any other, not an exemption.
      const current = await this.repository.load();
      const fresh = createPigGame(targetScore ?? this.config.defaultTargetScore);
      return this.repository.save({ ...fresh, version: current.version });
    });
  }
}
