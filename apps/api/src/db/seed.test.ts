import { registerRequestSchema } from '@dice-game/contracts';
import { describe, expect, it } from 'vitest';

import { type AppConfig, parseAppConfig } from '../config/env.schema';
import { DEMO_USERS, refuseToSeed } from './demo-seed';

/**
 * The seed's two refusals, and the credentials they guard.
 *
 * `SEED_DEMO_USERS` was declared in the environment schema and consumed by
 * nothing, which a security review flagged as dead config — a switch that
 * switches nothing looks, to the next reader, like protection already in place.
 * These assert that it is not decoration, and that production is refused
 * regardless of it.
 */

/** A configuration from a literal, exactly as `env.schema.test.ts` builds them. */
function configFor(env: Record<string, string>): AppConfig {
  return parseAppConfig(env);
}

const PRODUCTION_ENV = {
  NODE_ENV: 'production',
  JWT_SECRET: 'a-production-secret-of-entirely-sufficient-length',
  CORS_ORIGIN: 'https://dice.example',
  TRUST_PROXY_HOPS: '1',
};

describe('refuseToSeed', () => {
  it('allows a development run with the flag on', () => {
    expect(
      refuseToSeed(configFor({ NODE_ENV: 'development', SEED_DEMO_USERS: 'true' })),
    ).toBeNull();
  });

  it('refuses when SEED_DEMO_USERS is off, naming the variable to set', () => {
    const refusal = refuseToSeed(configFor({ NODE_ENV: 'development', SEED_DEMO_USERS: 'false' }));

    expect(refusal).toContain('SEED_DEMO_USERS');
  });

  it('refuses when SEED_DEMO_USERS is simply absent', () => {
    expect(refuseToSeed(configFor({ NODE_ENV: 'development' }))).not.toBeNull();
  });

  it('refuses production outright', () => {
    const refusal = refuseToSeed(configFor({ ...PRODUCTION_ENV, SEED_DEMO_USERS: 'false' }));

    expect(refusal).toContain('production');
  });

  /**
   * The ordering assertion, and the one that matters.
   *
   * `SEED_DEMO_USERS=true` is a permission in development and must not become
   * one in production. If the flag were checked first — or if the production
   * branch were an `else if` — this configuration would seed two accounts with
   * published passwords into a live database.
   */
  it('refuses production even when the flag says yes', () => {
    const refusal = refuseToSeed(configFor({ ...PRODUCTION_ENV, SEED_DEMO_USERS: 'true' }));

    expect(refusal).toContain('production');
    expect(refusal).not.toContain('SEED_DEMO_USERS');
  });
});

describe('the demo accounts', () => {
  it('are two, because a match needs an opponent', () => {
    expect(DEMO_USERS).toHaveLength(2);
  });

  /**
   * Registration would reject a password under ten characters or a display name
   * with an illegal character, and the failure would surface as a puzzle at the
   * login screen rather than as a broken seed.
   */
  it('would each survive POST /api/auth/register', () => {
    for (const demo of DEMO_USERS) {
      expect(registerRequestSchema.safeParse(demo).success, demo.email).toBe(true);
    }
  });

  it('use the reserved documentation domain, so no real inbox is ever involved', () => {
    for (const demo of DEMO_USERS) {
      expect(demo.email.endsWith('@example.com'), demo.email).toBe(true);
    }
  });

  it('have distinct addresses, or the second would collide with the first', () => {
    expect(new Set(DEMO_USERS.map((demo) => demo.email)).size).toBe(DEMO_USERS.length);
  });
});
