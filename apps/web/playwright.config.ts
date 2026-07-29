import path from 'node:path';

import { ROUTES } from '@dice-game/contracts';
import { defineConfig, devices } from '@playwright/test';

import { API_ORIGIN, API_PORT, E2E_MONGODB_URI, WEB_ORIGIN, WEB_PORT } from './e2e/support/config';

/**
 * The browser suite.
 *
 * Everything below `apps/web/e2e` runs against the **real stack**: a built API
 * on a real MongoDB and a built Next.js server, driven by a real Chromium. The
 * unit and integration suites already cover the rules and the persistence; what
 * only a browser can answer is whether two authenticated seats on one page
 * actually work — focus, disabled states, `sessionStorage`, and the animation
 * pause included.
 *
 * `pnpm --filter @dice-game/web run test:e2e` starts both servers itself. It
 * needs MongoDB (`docker compose up -d`) and a Chromium that Playwright can
 * find, and nothing else.
 */
const repoRoot = path.join(__dirname, '..', '..');

/**
 * The API, under the environment that binds the scripted dice.
 *
 * `NODE_ENV=test` is the whole reason the assertions in this suite can name a
 * number: it is the one value that resolves `DICE_GENERATOR` to
 * `DeterministicDiceGenerator` — see `dice-generator.provider.ts`, and
 * `e2e/support/dice.ts` for what the suite does with it.
 *
 * The rate limits and the Argon2 cost are lowered on purpose. A run registers
 * dozens of accounts in a few minutes, which is exactly what the production
 * budgets exist to refuse; leaving them alone would make this suite a test of
 * `AUTH_RATE_LIMIT_MAX`. Both are environment variables precisely so a
 * deployment can set them and a test can too.
 */
const apiEnv: Record<string, string> = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(API_PORT),
  MONGODB_URI: E2E_MONGODB_URI,
  JWT_SECRET: 'e2e-only-not-a-secret',
  JWT_EXPIRES_IN: '30m',
  CORS_ORIGIN: `${WEB_ORIGIN},http://localhost:${WEB_PORT}`,
  LOG_LEVEL: 'warn',
  LOG_PRETTY: 'true',
  RATE_LIMIT_MAX: '100000',
  AUTH_RATE_LIMIT_MAX: '100000',
  ARGON2_MEMORY_KIB: '8192',
  ARGON2_TIME_COST: '1',
  SEED_DEMO_USERS: 'false',
};

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',

  /**
   * One worker, and no parallelism inside a file.
   *
   * Not a concession to flakiness: the deterministic dice generator is a
   * singleton in the API process, so two tests rolling at the same time would
   * draw from one interleaved cursor and neither could say what it expected.
   */
  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },

  /**
   * The list reporter only, deliberately.
   *
   * The HTML reporter writes a `playwright-report/` directory full of bundled
   * JavaScript, and `@dice-game/eslint-config` ignores `dist`, `.next`,
   * `coverage` and `node_modules` but not that — so generating it by default
   * would break `pnpm lint` for anyone who had run the tests. Everything the
   * report would show is on disk anyway: videos, screenshots and traces land in
   * `test-results/`, and a trace opens with `playwright show-trace`. Ask for the
   * report explicitly when you want it: `pnpm test:e2e -- --reporter=html`.
   */
  reporter: [['list']],

  globalSetup: './e2e/global-setup.ts',

  use: {
    baseURL: WEB_ORIGIN,
    /**
     * A recording of every scenario, because there is no live URL to point at.
     * Videos land in `test-results/`, which is git-ignored — they are evidence
     * of a run, not an artefact of the repository. The one committed image is
     * the full-page screenshot the match scenario writes to `e2e/artifacts/`.
     */
    video: 'on',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
  },

  projects: [
    {
      name: 'chromium',
      /**
       * `Desktop Chrome` names no channel, so this is Playwright's own bundled
       * Chromium rather than a system Google Chrome. `@playwright/test` is
       * pinned to an exact `1.56.0` for the same reason: that release wants
       * chromium revision 1194, which is the revision installed here. A caret
       * range would resolve forward on the next lockfile refresh and ask for a
       * build nobody has downloaded.
       */
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @dice-game/api... run build && node apps/api/dist/main.js',
      cwd: repoRoot,
      url: `${API_ORIGIN}${ROUTES.health.ready}`,
      env: apiEnv,
      // Never reuse. A server already on this port is one this suite did not
      // configure, which means it may be pointed at the development database
      // with real dice — and the run would look like it passed.
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command:
        'pnpm --filter @dice-game/web... run build && ' +
        'pnpm --filter @dice-game/web exec next start --hostname 127.0.0.1 --port ' +
        String(WEB_PORT),
      cwd: repoRoot,
      url: WEB_ORIGIN,
      // `NEXT_PUBLIC_API_URL` is inlined by `next build`, not read at runtime,
      // so it has to be set for the build half of this command as well as the
      // start half. That is why they are one command rather than two.
      env: { NODE_ENV: 'production', NEXT_PUBLIC_API_URL: API_ORIGIN },
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
