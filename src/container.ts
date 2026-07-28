import type { Express } from 'express';

import { loadEnv, type Env } from './config/env';
import type { GameRepository } from './core/ports/game-repository.port';
import type { PasswordHasher } from './core/ports/password-hasher.port';
import type { RandomGenerator } from './core/ports/random-generator.port';
import type { UserRepository } from './core/ports/user-repository.port';
import { AuthService } from './core/services/auth.service';
import { GameService } from './core/services/game.service';
import { PigGameService } from './core/services/pig-game.service';
import { InMemoryAuthTokenService } from './infrastructure/auth/in-memory-auth-token.service';
import { ScryptPasswordHasher } from './infrastructure/auth/scrypt-password-hasher';
import { AsyncMutex } from './infrastructure/concurrency/async-mutex';
import { UuidGenerator } from './infrastructure/id/uuid-generator';
import { createLogger, type Logger } from './infrastructure/logging/logger';
import { InMemoryGameRepository } from './infrastructure/persistence/in-memory-game.repository';
import { InMemoryPigGameRepository } from './infrastructure/persistence/in-memory-pig-game.repository';
import { InMemoryUserRepository } from './infrastructure/persistence/in-memory-user.repository';
import { CryptoRandomGenerator } from './infrastructure/random/crypto-random.generator';
import { SystemClock } from './infrastructure/time/system-clock';
import { createApp } from './http/app';
import { AuthController } from './http/controllers/auth.controller';
import { GameController } from './http/controllers/game.controller';
import { HealthController } from './http/controllers/health.controller';
import { PigGameController } from './http/controllers/pig-game.controller';

/** Injected at build time; falls back to the package version in development. */
const SERVICE_VERSION = process.env.APP_VERSION ?? '1.0.0';

export interface Container {
  readonly env: Env;
  readonly logger: Logger;
  readonly app: Express;
  readonly gameRepository: GameRepository;
  readonly userRepository: UserRepository;
  readonly setReady: (ready: boolean) => void;
}

export interface ContainerOptions {
  /** Overrides for tests — supply a fixed clock, scripted RNG, etc. */
  readonly env?: Partial<Env>;
  readonly repository?: GameRepository;
  /**
   * RNG override so integration tests can script dice. The Pig rules branch on
   * the rolled values, so deterministic end-to-end coverage needs this seam.
   */
  readonly random?: RandomGenerator;
  /**
   * Password hashing override. The shipped hasher is deliberately slow (~100ms
   * per call by design); an integration suite that registers a dozen players
   * would spend most of its runtime in a KDF that is not what it is testing.
   */
  readonly passwordHasher?: PasswordHasher;
}

/**
 * Composition root.
 *
 * The single place in the codebase where concrete implementations are named.
 * Every other module depends on interfaces only, which is what makes the
 * in-memory→PostgreSQL migration a one-line change here rather than a
 * find-and-replace across the service layer.
 *
 * Wiring is manual and explicit. A reflection-based DI container would add a
 * runtime dependency, decorator metadata, and a layer of indirection to solve a
 * problem that a dozen constructor calls do not have.
 */
export function createContainer(options: ContainerOptions = {}): Container {
  // Overrides are merged into the raw source *before* validation, so a test
  // override is validated by the same schema as a real deployment — and an
  // unrelated stray variable in the ambient environment cannot fail a test that
  // supplies its own configuration.
  const env = loadEnv({ ...process.env, ...toEnvSource(options.env) });
  const logger = createLogger(env);

  // --- Infrastructure adapters -------------------------------------------
  const gameRepository = options.repository ?? new InMemoryGameRepository();
  const pigGameRepository = new InMemoryPigGameRepository();
  const userRepository = new InMemoryUserRepository();
  const random = options.random ?? new CryptoRandomGenerator();
  const clock = new SystemClock();
  const idGenerator = new UuidGenerator();
  const lock = new AsyncMutex();
  const passwordHasher = options.passwordHasher ?? new ScryptPasswordHasher();
  const authTokenService = new InMemoryAuthTokenService({
    clock,
    ttlMs: env.AUTH_TOKEN_TTL_MS,
  });

  // --- Application services ----------------------------------------------
  const authService = new AuthService({
    users: userRepository,
    hasher: passwordHasher,
    tokens: authTokenService,
    idGenerator,
    clock,
  });

  const gameService = new GameService({
    repository: gameRepository,
    random,
    clock,
    idGenerator,
    lock,
    config: {
      defaultRounds: env.GAME_DEFAULT_ROUNDS,
      maxRounds: env.GAME_MAX_ROUNDS,
    },
  });

  const pigGameService = new PigGameService({
    repository: pigGameRepository,
    users: userRepository,
    random,
    lock,
    config: { defaultTargetScore: env.PIG_TARGET_SCORE },
  });

  // --- Delivery layer ------------------------------------------------------
  // Readiness is owned here rather than by a module-level global so that tests
  // (and any future multi-instance embedding) get an isolated flag per app.
  let ready = true;

  const authController = new AuthController(authService);
  const gameController = new GameController(gameService);
  const pigGameController = new PigGameController(pigGameService, authService);
  const healthController = new HealthController({
    clock,
    version: SERVICE_VERSION,
    serviceName: env.SERVICE_NAME,
    isReady: () => ready,
  });

  const app = createApp({
    env,
    logger,
    authService,
    authController,
    gameController,
    pigGameController,
    healthController,
  });

  return {
    env,
    logger,
    app,
    gameRepository,
    userRepository,
    setReady: (value: boolean): void => {
      ready = value;
    },
  };
}

/**
 * Converts typed overrides back into the string-valued shape `process.env` has,
 * so they pass through the same coercion and validation as real configuration.
 */
function toEnvSource(overrides: Partial<Env> | undefined): NodeJS.ProcessEnv {
  if (!overrides) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(overrides)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}
