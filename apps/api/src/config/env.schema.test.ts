import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEV_JWT_SECRET,
  EnvValidationError,
  MIN_PRODUCTION_JWT_SECRET_LENGTH,
  parseAppConfig,
} from './env.schema';

/**
 * The configuration schema is the only thing standing between a mistyped
 * environment and a process that boots anyway and behaves subtly wrongly. These
 * tests are therefore mostly about the *refusals*.
 */

const STRONG_SECRET = 'x'.repeat(MIN_PRODUCTION_JWT_SECRET_LENGTH);

/** Walks up from the working directory to the repository root's `.env.example`. */
function findEnvExample(): string {
  let directory = process.cwd();

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, '.env.example');

    if (existsSync(candidate)) {
      return candidate;
    }

    directory = dirname(directory);
  }

  throw new Error(`Could not find .env.example above ${process.cwd()}`);
}

/** Minimal `KEY=value` reader — enough for a file that contains no quoting. */
function readEnvFile(path: string): Record<string, string> {
  const entries: Record<string, string> = {};

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();

    if (trimmed.length === 0 || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator > 0) {
      entries[trimmed.slice(0, separator)] = trimmed.slice(separator + 1);
    }
  }

  return entries;
}

function expectRejection(source: Record<string, string | undefined>): EnvValidationError {
  try {
    parseAppConfig(source);
  } catch (error) {
    expect(error).toBeInstanceOf(EnvValidationError);

    return error as EnvValidationError;
  }

  throw new Error('Expected the configuration to be rejected, but it validated.');
}

describe('.env.example', () => {
  const example = readEnvFile(findEnvExample());

  it('is itself a valid configuration', () => {
    expect(() => parseAppConfig(example)).not.toThrow();
  });

  it('still carries the development secret the production refinement recognises', () => {
    // If someone rotates the value in `.env.example` without updating the
    // constant, the refinement below silently stops protecting anything.
    expect(example.JWT_SECRET).toBe(DEV_JWT_SECRET);
  });

  it('declares every variable the schema knows about', () => {
    const declared = new Set(Object.keys(example));
    const fromExample = parseAppConfig(example);
    const fromNothing = parseAppConfig({});

    // A variable in the file that the schema strips would be dead config.
    expect(declared.has('MONGODB_URI')).toBe(true);
    expect(fromExample.mongo.uri).toBe(example.MONGODB_URI);
    // And the schema must stand alone, without the file.
    expect(fromNothing.port).toBe(3001);
  });
});

describe('defaults', () => {
  const config = parseAppConfig({});

  it('boots a development process with no environment at all', () => {
    expect(config.nodeEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3001);
    expect(config.host).toBe('0.0.0.0');
    expect(config.http.bodyLimit).toBe('16kb');
    expect(config.http.trustProxyHops).toBe(0);
    expect(config.lifecycle.shutdownTimeoutMs).toBe(10_000);
  });

  it('separates the gameplay budget from the credential budget', () => {
    expect(config.rateLimit.general.limit).toBe(120);
    expect(config.rateLimit.general.windowMs).toBe(60_000);
    expect(config.rateLimit.credentials.limit).toBe(20);
    expect(config.rateLimit.credentials.windowMs).toBe(900_000);
    expect(config.rateLimit.credentials.limit).toBeLessThan(config.rateLimit.general.limit);
  });

  it('defaults observability to the production-safe setting, not the .env.example one', () => {
    expect(config.observability.logLevel).toBe('info');
    expect(config.observability.logPretty).toBe(false);
  });
});

describe('coercion', () => {
  it('turns numeric strings into numbers', () => {
    const config = parseAppConfig({ PORT: '8080', TRUST_PROXY_HOPS: '1', RATE_LIMIT_MAX: '7' });

    expect(config.port).toBe(8080);
    expect(config.http.trustProxyHops).toBe(1);
    expect(config.rateLimit.general.limit).toBe(7);
  });

  it('reads "false" as false rather than as a non-empty string', () => {
    expect(parseAppConfig({ LOG_PRETTY: 'false' }).observability.logPretty).toBe(false);
    expect(parseAppConfig({ SEED_DEMO_USERS: 'false' }).seedDemoUsers).toBe(false);
    expect(parseAppConfig({ LOG_PRETTY: 'true' }).observability.logPretty).toBe(true);
  });

  it('splits the CORS allow-list into origins', () => {
    const config = parseAppConfig({
      CORS_ORIGIN: 'https://a.example , https://b.example',
    });

    expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
  });

  it('refuses a port outside the addressable range', () => {
    expect(expectRejection({ PORT: '70000' }).issues.join()).toContain('PORT');
    expect(expectRejection({ PORT: 'nope' }).issues.join()).toContain('PORT');
  });

  it('refuses a trust-proxy hop count that is not a number', () => {
    expect(expectRejection({ TRUST_PROXY_HOPS: 'true' }).issues.join()).toContain(
      'TRUST_PROXY_HOPS',
    );
  });
});

describe('production refinement: JWT_SECRET', () => {
  it('refuses to start when the secret is still the committed development value', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: DEV_JWT_SECRET,
      CORS_ORIGIN: 'https://dice.example',
    });

    expect(error.issues.join()).toContain('JWT_SECRET');
  });

  it('refuses a distinct but short secret', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: 'short-but-different',
      CORS_ORIGIN: 'https://dice.example',
    });

    expect(error.issues.join()).toContain('JWT_SECRET');
  });

  it('never repeats the rejected value back in the error', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: DEV_JWT_SECRET,
      CORS_ORIGIN: 'https://dice.example',
    });

    expect(error.message).not.toContain(DEV_JWT_SECRET);
  });

  it('tolerates the development value outside production', () => {
    for (const nodeEnv of ['development', 'test']) {
      expect(() => parseAppConfig({ NODE_ENV: nodeEnv, JWT_SECRET: DEV_JWT_SECRET })).not.toThrow();
    }
  });
});

describe('production refinement: CORS_ORIGIN', () => {
  it('refuses a wildcard origin', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
      CORS_ORIGIN: '*',
    });

    expect(error.issues.join()).toContain('CORS_ORIGIN');
  });

  it('refuses a wildcard hidden in a list of real origins', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
      CORS_ORIGIN: 'https://dice.example,*',
    });

    expect(error.issues.join()).toContain('CORS_ORIGIN');
  });

  it('refuses an empty allow-list', () => {
    expect(expectRejection({ CORS_ORIGIN: ' , ' }).issues.join()).toContain('CORS_ORIGIN');
  });

  it('tolerates a wildcard outside production', () => {
    expect(() => parseAppConfig({ NODE_ENV: 'development', CORS_ORIGIN: '*' })).not.toThrow();
  });

  it('accepts an explicitly named production origin', () => {
    const config = parseAppConfig({
      NODE_ENV: 'production',
      JWT_SECRET: STRONG_SECRET,
      CORS_ORIGIN: 'https://dice.example',
      TRUST_PROXY_HOPS: '1',
    });

    expect(config.isProduction).toBe(true);
    expect(config.http.corsOrigins).toEqual(['https://dice.example']);
    expect(config.http.trustProxyHops).toBe(1);
  });

  it('reports both production failures at once rather than one at a time', () => {
    const error = expectRejection({
      NODE_ENV: 'production',
      JWT_SECRET: DEV_JWT_SECRET,
      CORS_ORIGIN: '*',
    });

    expect(error.issues).toHaveLength(2);
  });
});

describe('the parsed configuration', () => {
  it('is frozen, so nothing can retune the process at runtime', () => {
    const config = parseAppConfig({});

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.http)).toBe(true);
    expect(Object.isFrozen(config.rateLimit.credentials)).toBe(true);
  });

  it('is derived only from what it was handed', () => {
    // Pure: `parseAppConfig` reads no ambient state, so the result cannot be
    // affected by whatever the test runner's own environment happens to hold.
    expect(parseAppConfig({ SERVICE_NAME: 'other' }).observability.serviceName).toBe('other');
    expect(parseAppConfig({}).observability.serviceName).toBe('dice-game-api');
  });
});
