import { z } from 'zod';

import { PIG_MAX_TARGET_SCORE, PIG_MIN_TARGET_SCORE } from '../core/domain/pig-game';

/**
 * Environment contract.
 *
 * Parsed and validated exactly once, at process boot. A misconfigured service
 * must fail immediately and visibly rather than starting up and failing later
 * on a request path — a crash-looping container is a signal an operator can
 * act on; a 500 on one endpoint at 3am is not.
 */
const booleanFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),

    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromString.default('false'),
    SERVICE_NAME: z.string().min(1).default('dice-game-service'),

    CORS_ORIGIN: z.string().default('*'),
    BODY_LIMIT: z.string().default('16kb'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

    GAME_DEFAULT_ROUNDS: z.coerce.number().int().positive().default(5),
    GAME_MAX_ROUNDS: z.coerce.number().int().positive().default(20),

    /**
     * Pig game target used when NEW GAME does not name one. Bounded by the
     * domain's playable range so a misconfigured default fails at boot rather
     * than on the first reset.
     */
    PIG_TARGET_SCORE: z.coerce
      .number()
      .int()
      .min(PIG_MIN_TARGET_SCORE)
      .max(PIG_MAX_TARGET_SCORE)
      .default(100),
  })
  .refine((cfg) => cfg.GAME_DEFAULT_ROUNDS <= cfg.GAME_MAX_ROUNDS, {
    message: 'GAME_DEFAULT_ROUNDS must be less than or equal to GAME_MAX_ROUNDS',
    path: ['GAME_DEFAULT_ROUNDS'],
  });

export type Env = z.infer<typeof envSchema>;

/**
 * Parses configuration from a raw source (defaults to `process.env`).
 *
 * Accepting the source as an argument keeps this unit testable without
 * mutating global process state across test files.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

/**
 * Parsed CORS allowlist. `*` means "reflect any origin".
 */
export function parseCorsOrigin(raw: string): string[] | '*' {
  const trimmed = raw.trim();
  if (trimmed === '*' || trimmed === '') {
    return '*';
  }
  return trimmed
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
