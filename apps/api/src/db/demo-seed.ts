import { type AppConfig } from '../config/env.schema';

/**
 * What `pnpm db:seed` creates, and when it is allowed to create it.
 *
 * Separated from `seed.ts` because that file is an *executable* — importing it
 * boots a Nest context and opens a connection. Everything worth asserting is
 * here instead, so `seed.test.ts` can assert it without a database.
 */

/** A demo account, as this project defines one. */
export interface DemoUser {
  readonly email: string;
  readonly displayName: string;
  /** Plaintext, on purpose, and never used anywhere a real password would be. */
  readonly password: string;
}

/**
 * The two players.
 *
 * Two, not one: every gameplay path in this application needs an opponent, so a
 * single seeded account would let a reviewer log in and do nothing.
 *
 * `@example.com` is the reserved documentation domain from RFC 2606, so neither
 * address can belong to a real person who then receives mail because somebody
 * pointed this at the wrong database.
 */
export const DEMO_USERS: readonly DemoUser[] = Object.freeze([
  Object.freeze({
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    password: 'demo-password-ada',
  }),
  Object.freeze({
    email: 'grace@example.com',
    displayName: 'Grace Hopper',
    password: 'demo-password-grace',
  }),
]);

/**
 * Why this run may not touch the database, or `null` to proceed.
 *
 * Two refusals, and **the order is the point**:
 *
 *  1. `NODE_ENV=production` — never, whatever else is set. The passwords above
 *     are in the repository and are printed to the terminal, so these accounts
 *     are two working logins to anyone who has read this file. `SEED_DEMO_USERS=true`
 *     in a production environment is still a refusal, not a permission, which is
 *     exactly what the first branch being first guarantees.
 *  2. `SEED_DEMO_USERS=false` — refused, with the variable named. The flag was
 *     declared in `env.schema.ts` and consumed by nothing, which a security
 *     review flagged: a switch that switches nothing reads, to the next person,
 *     as protection already in place. This is its consumer, so it now means what
 *     `.env.example` says it means.
 *
 * Both are checked before a connection is opened. A refusal that has already
 * dialled the database is a refusal that has already found the wrong one.
 */
export function refuseToSeed(config: AppConfig): string | null {
  if (config.isProduction) {
    return 'Refusing to seed: NODE_ENV=production. These accounts have published passwords and must never exist in a production database.';
  }

  if (!config.seedDemoUsers) {
    return 'Refusing to seed: SEED_DEMO_USERS is false. Set SEED_DEMO_USERS=true in your .env to create the demo players.';
  }

  return null;
}
