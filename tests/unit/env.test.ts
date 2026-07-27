import { loadEnv, parseCorsOrigin } from '../../src/config/env';

describe('loadEnv', () => {
  it('applies defaults for an empty environment', () => {
    const env = loadEnv({});

    expect(env).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      HOST: '0.0.0.0',
      LOG_LEVEL: 'info',
      GAME_DEFAULT_ROUNDS: 5,
      GAME_MAX_ROUNDS: 20,
    });
  });

  it('coerces numeric strings, since every env var arrives as a string', () => {
    const env = loadEnv({ PORT: '8080', RATE_LIMIT_MAX: '25' });

    expect(env.PORT).toBe(8080);
    expect(env.RATE_LIMIT_MAX).toBe(25);
  });

  it('parses booleans from strings', () => {
    expect(loadEnv({ LOG_PRETTY: 'true' }).LOG_PRETTY).toBe(true);
    expect(loadEnv({ LOG_PRETTY: 'false' }).LOG_PRETTY).toBe(false);
  });

  it.each([
    ['PORT', 'not-a-number'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['RATE_LIMIT_MAX', '0'],
    ['TRUST_PROXY_HOPS', '-1'],
  ])('rejects an invalid %s', (key, value) => {
    expect(() => loadEnv({ [key]: value })).toThrow(/Invalid environment configuration/);
  });

  it('rejects a default round count above the maximum', () => {
    expect(() => loadEnv({ GAME_DEFAULT_ROUNDS: '30', GAME_MAX_ROUNDS: '20' })).toThrow(
      /GAME_DEFAULT_ROUNDS must be less than or equal to GAME_MAX_ROUNDS/,
    );
  });

  it('names the offending variable in the message', () => {
    expect(() => loadEnv({ PORT: 'abc' })).toThrow(/PORT/);
  });
});

describe('parseCorsOrigin', () => {
  it('treats * and empty as "any origin"', () => {
    expect(parseCorsOrigin('*')).toBe('*');
    expect(parseCorsOrigin('   ')).toBe('*');
  });

  it('splits and trims a comma-separated allowlist', () => {
    expect(parseCorsOrigin('https://a.com, https://b.com')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('discards empty entries from a trailing comma', () => {
    expect(parseCorsOrigin('https://a.com,,')).toEqual(['https://a.com']);
  });
});
