import type { Express } from 'express';

import { loadEnv, type Env } from './config/env';
import type { GameRepository } from './core/ports/game-repository.port';
import { GameService } from './core/services/game.service';
import { AsyncMutex } from './infrastructure/concurrency/async-mutex';
import { UuidGenerator } from './infrastructure/id/uuid-generator';
import { createLogger, type Logger } from './infrastructure/logging/logger';
import { InMemoryGameRepository } from './infrastructure/persistence/in-memory-game.repository';
import { CryptoRandomGenerator } from './infrastructure/random/crypto-random.generator';
import { SystemClock } from './infrastructure/time/system-clock';
import { createApp } from './http/app';
import { GameController } from './http/controllers/game.controller';
import { HealthController } from './http/controllers/health.controller';

/** Injected at build time; falls back to the package version in development. */
const SERVICE_VERSION = process.env.APP_VERSION ?? '1.0.0';

export interface Container {
  readonly env: Env;
  readonly logger: Logger;
  readonly app: Express;
  readonly gameRepository: GameRepository;
  readonly setReady: (ready: boolean) => void;
}

export interface ContainerOptions {
  /** Overrides for tests — supply a fixed clock, scripted RNG, etc. */
  readonly env?: Partial<Env>;
  readonly repository?: GameRepository;
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
 * problem that eight constructor calls do not have.
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
  const random = new CryptoRandomGenerator();
  const clock = new SystemClock();
  const idGenerator = new UuidGenerator();
  const lock = new AsyncMutex();

  // --- Application services ----------------------------------------------
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

  // --- Delivery layer ------------------------------------------------------
  // Readiness is owned here rather than by a module-level global so that tests
  // (and any future multi-instance embedding) get an isolated flag per app.
  let ready = true;

  const gameController = new GameController(gameService);
  const healthController = new HealthController({
    clock,
    version: SERVICE_VERSION,
    serviceName: env.SERVICE_NAME,
    isReady: () => ready,
  });

  const app = createApp({ env, logger, gameController, healthController });

  return {
    env,
    logger,
    app,
    gameRepository,
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
