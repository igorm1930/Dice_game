import { z } from 'zod';

/**
 * The configuration boundary.
 *
 * Every variable in the repository-root `.env.example` is declared here exactly
 * once, with a default, a type and a bound. Nothing else in the API reads
 * `process.env` — a value that is not in this file does not exist as far as the
 * application is concerned.
 *
 * The schema is parsed **once, at boot**, and the process refuses to start if it
 * does not validate. That is deliberate: a mistyped `TRUST_PROXY_HOPS` or a
 * production deploy still carrying the development JWT secret is a security
 * defect, and the only safe time to discover it is before the first request.
 * Nothing here falls back to a "safe-ish" value at runtime.
 *
 * Two cross-field rules matter enough to be called out:
 *
 *  - `NODE_ENV=production` while `JWT_SECRET` is still the committed development
 *    value is a hard failure. The secret is in the repository; a deployment that
 *    kept it is signing tokens anyone can forge.
 *  - `NODE_ENV=production` with `CORS_ORIGIN='*'` is a hard failure. A wildcard
 *    origin is a development convenience; in production it invites any page on
 *    the internet to drive the API with a user's token.
 */

/**
 * The value committed to `.env.example`. Duplicated here on purpose so the
 * refinement below can recognise it; `apps/api/src/config/env.schema.test.ts`
 * asserts the two are still the same string.
 */
export const DEV_JWT_SECRET = 'dev-only-not-a-secret-change-me-in-production';

/** Below this a production secret is guessable regardless of how it was chosen. */
export const MIN_PRODUCTION_JWT_SECRET_LENGTH = 32;

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * `z.coerce.boolean()` is unusable for environment variables: it follows
 * JavaScript truthiness, so the string `'false'` is `true`. Only the four
 * spellings below are accepted, and anything else is a configuration error
 * rather than a silently-enabled feature.
 */
const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/** `16kb`, `512b`, `1mb` — the vocabulary the body parser understands. */
const byteSizeSchema = z.string().regex(/^\d+(b|kb|mb)$/i, 'Must be a byte size such as 16kb');

/** `15m`, `900s`, `7d` — the vocabulary `@nestjs/jwt` understands. */
const durationSchema = z.string().regex(/^\d+(ms|s|m|h|d)?$/, 'Must be a duration such as 15m');

const integer = (): z.ZodNumber => z.coerce.number().int();

/**
 * The raw environment, before any of it is shaped into {@link AppConfig}.
 *
 * Unknown keys are stripped rather than rejected — `process.env` legitimately
 * carries hundreds of variables this application has no opinion about.
 */
export const envVarsSchema = z.object({
  // ---- Runtime ----
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: integer().min(1).max(65535).default(3001),
  HOST: z.string().min(1).default('0.0.0.0'),

  // ---- Database ----
  MONGODB_URI: z.string().min(1).default('mongodb://localhost:27017/dice-game'),
  MONGODB_DB_NAME: z.string().min(1).default('dice-game'),

  // ---- Authentication ----
  JWT_SECRET: z.string().min(1).default(DEV_JWT_SECRET),
  JWT_EXPIRES_IN: durationSchema.default('15m'),
  /** Argon2id cost. Raise memory before raising time cost — see `.env.example`. */
  ARGON2_MEMORY_KIB: integer().min(8192).max(1_048_576).default(19_456),
  ARGON2_TIME_COST: integer().min(1).max(10).default(2),
  ARGON2_PARALLELISM: integer().min(1).max(16).default(1),

  // ---- HTTP ----
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  BODY_LIMIT: byteSizeSchema.default('16kb'),
  /**
   * Proxy hops to trust when resolving the client IP. Bounded because the
   * failure mode is asymmetric and severe: too high and a client sets its own
   * `X-Forwarded-For`, minting a fresh rate-limit key for every request.
   */
  TRUST_PROXY_HOPS: integer().min(0).max(10).optional(),

  // ---- Rate limiting ----
  RATE_LIMIT_WINDOW_MS: integer().min(1000).default(60_000),
  RATE_LIMIT_MAX: integer().min(1).default(120),
  AUTH_RATE_LIMIT_WINDOW_MS: integer().min(1000).default(900_000),
  AUTH_RATE_LIMIT_MAX: integer().min(1).default(20),

  // ---- Lifecycle ----
  SHUTDOWN_TIMEOUT_MS: integer().min(0).max(120_000).default(10_000),

  // ---- Observability ----
  /**
   * Defaults are the production-safe ones. `.env.example` overrides both for
   * local development, which is the right way round: forgetting to set them in
   * production yields quiet NDJSON, not pretty-printed debug output.
   */
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_PRETTY: booleanFromEnv.default('false'),
  SERVICE_NAME: z.string().min(1).default('dice-game-api'),
  /**
   * Reported by `/api/health/live`. Not in `.env.example` because it is not a
   * local knob — the container build stamps it.
   */
  SERVICE_VERSION: z.string().min(1).default('0.0.0'),

  // ---- Demo data ----
  SEED_DEMO_USERS: booleanFromEnv.default('false'),

  // ---- Frontend ----
  /**
   * Read at build time by Next.js, never by this process. Declared so that the
   * one file listing this system's configuration lists all of it.
   */
  NEXT_PUBLIC_API_URL: z.string().url().default('http://localhost:3001'),
});

export type EnvVars = z.infer<typeof envVarsSchema>;

/** Splits the comma-separated `CORS_ORIGIN` allow-list into origins. */
export function parseOriginList(raw: string): readonly string[] {
  return Object.freeze(
    raw
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

export const envSchema = envVarsSchema.superRefine((env, ctx) => {
  const origins = parseOriginList(env.CORS_ORIGIN);

  if (origins.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message: 'Must name at least one origin.',
    });
  }

  if (env.NODE_ENV !== 'production') {
    return;
  }

  if (env.JWT_SECRET === DEV_JWT_SECRET) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message:
        'Refusing to start: JWT_SECRET is still the development value committed to .env.example. Set a distinct high-entropy secret in production.',
    });
  } else if (env.JWT_SECRET.length < MIN_PRODUCTION_JWT_SECRET_LENGTH) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: `Refusing to start: JWT_SECRET must be at least ${MIN_PRODUCTION_JWT_SECRET_LENGTH} characters in production.`,
    });
  }

  if (origins.includes('*')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message:
        'Refusing to start: CORS_ORIGIN may not be "*" in production. Name the browser origins explicitly.',
    });
  }

  // The default of 0 is right locally and wrong behind any proxy, and getting
  // it wrong fails *closed* rather than open: every request resolves to the
  // load balancer's address, so all traffic shares one rate-limit bucket and
  // the service throttles itself. That is a silent outage rather than a
  // security hole, which is precisely why nothing would catch it. Production
  // has to state the hop count deliberately.
  if (env.TRUST_PROXY_HOPS === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TRUST_PROXY_HOPS'],
      message:
        'Refusing to start: TRUST_PROXY_HOPS must be set explicitly in production. Use the number of proxies in front of this service — 1 behind Fly. Leaving it unset keys every client on the load balancer and collapses rate limiting onto a single shared bucket.',
    });
  }
});

/** Cost parameters handed to argon2id. */
export interface Argon2Config {
  readonly memoryCostKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

export interface RateLimitBudget {
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Requests permitted per window, per tracked client. */
  readonly limit: number;
}

/**
 * The shape the application actually consumes: grouped, typed, and with the
 * derived values (origin list, `isProduction`) already computed so no consumer
 * re-parses a string.
 */
export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly host: string;
  readonly mongo: {
    readonly uri: string;
    readonly dbName: string;
  };
  readonly auth: {
    readonly jwtSecret: string;
    readonly jwtExpiresIn: string;
    readonly argon2: Argon2Config;
  };
  readonly http: {
    readonly corsOrigins: readonly string[];
    readonly bodyLimit: string;
    readonly trustProxyHops: number;
  };
  readonly rateLimit: {
    readonly general: RateLimitBudget;
    readonly credentials: RateLimitBudget;
  };
  readonly lifecycle: {
    readonly shutdownTimeoutMs: number;
  };
  readonly observability: {
    readonly logLevel: LogLevel;
    readonly logPretty: boolean;
    readonly serviceName: string;
    readonly serviceVersion: string;
  };
  readonly seedDemoUsers: boolean;
}

/**
 * Raised when the environment does not validate.
 *
 * Carries the *paths and reasons*, never the values: a rejected `JWT_SECRET` or
 * `MONGODB_URI` must not end up in a crash log.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

function toAppConfig(env: EnvVars): AppConfig {
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    host: env.HOST,
    mongo: Object.freeze({
      uri: env.MONGODB_URI,
      dbName: env.MONGODB_DB_NAME,
    }),
    auth: Object.freeze({
      jwtSecret: env.JWT_SECRET,
      jwtExpiresIn: env.JWT_EXPIRES_IN,
      argon2: Object.freeze({
        memoryCostKib: env.ARGON2_MEMORY_KIB,
        timeCost: env.ARGON2_TIME_COST,
        parallelism: env.ARGON2_PARALLELISM,
      }),
    }),
    http: Object.freeze({
      corsOrigins: parseOriginList(env.CORS_ORIGIN),
      bodyLimit: env.BODY_LIMIT,
      // Absent means 0, which is correct for local development and for tests.
      // Production never reaches here without an explicit value.
      trustProxyHops: env.TRUST_PROXY_HOPS ?? 0,
    }),
    rateLimit: Object.freeze({
      general: Object.freeze({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        limit: env.RATE_LIMIT_MAX,
      }),
      credentials: Object.freeze({
        windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
        limit: env.AUTH_RATE_LIMIT_MAX,
      }),
    }),
    lifecycle: Object.freeze({
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    }),
    observability: Object.freeze({
      logLevel: env.LOG_LEVEL,
      logPretty: env.LOG_PRETTY,
      serviceName: env.SERVICE_NAME,
      serviceVersion: env.SERVICE_VERSION,
    }),
    seedDemoUsers: env.SEED_DEMO_USERS,
  });
}

/**
 * Validates a raw environment and shapes it into {@link AppConfig}.
 *
 * Pure: it reads nothing ambient, so a test can hand it a literal.
 *
 * @throws {EnvValidationError} if any variable is missing, mistyped or, in
 * production, still carrying a development value.
 */
export function parseAppConfig(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  return toAppConfig(result.data);
}

let cached: AppConfig | null = null;

/**
 * The process-wide configuration, parsed on first call and memoised.
 *
 * "Parsed once at boot" is enforced here rather than trusted: every consumer
 * receives the same frozen object, so nothing can observe the environment
 * changing underneath it mid-process.
 */
export function loadAppConfig(): AppConfig {
  cached ??= parseAppConfig(process.env);

  return cached;
}

/**
 * Drops the memoised configuration.
 *
 * Exists for tests that need to boot an application under a different
 * environment. Production code has no reason to call it.
 */
export function resetAppConfigCache(): void {
  cached = null;
}
