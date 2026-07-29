/**
 * Where this suite runs, and what it is allowed to touch.
 *
 * Imported by `playwright.config.ts` as well as by the tests, so the ports the
 * servers are started on and the ports the tests talk to cannot disagree.
 *
 * The ports are deliberately **not** 3000/3001. Those belong to `pnpm dev`, and
 * a run that quietly attached itself to a developer's dev server would be
 * playing against the development database with real dice — see
 * `reuseExistingServer: false` in the config for the other half of that
 * decision.
 */
export const WEB_PORT = 3100;
export const API_PORT = 3101;

export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

/**
 * A database of its own.
 *
 * Never `dice-game`: a run empties this before it starts, and doing that to the
 * database somebody has been playing in by hand would be unforgivable. The
 * override exists for CI, where MongoDB may not be on localhost.
 */
export const E2E_MONGODB_URI =
  process.env.E2E_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/dice-game-e2e';
