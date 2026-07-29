import { type APIRequestContext, test as base } from '@playwright/test';

import { API_ORIGIN } from './support/config';
import { alignDice, openScratchMatch, type ScratchMatch } from './support/dice';

/**
 * The two things every scenario in this suite needs before it can start.
 *
 *  - `api` — a request context pointed at the **API**, not at the web app. The
 *    built-in `request` fixture inherits `baseURL`, which is the browser origin,
 *    and a test that quietly posted its registrations to Next.js would 404 in a
 *    confusing way.
 *  - `alignedDice` — the scripted dice, wound to the start of their cycle. It is
 *    `auto`, so it runs for every test whether or not the test names it: a
 *    scenario that forgot to ask would inherit the cursor left by the one before
 *    it and fail on a number rather than on a missing fixture. See
 *    `support/dice.ts` for why the cursor is shared at all.
 *
 * `api` and the scratch match are worker-scoped because neither carries any
 * per-test state, and the scratch match in particular costs two registered
 * accounts that would otherwise crowd the opponent picker.
 *
 * The second argument of a fixture is Playwright's "now run the test with this
 * value" callback. It is named `provide` rather than the documented `use`
 * because `react-hooks/rules-of-hooks` reads a call to `use()` as React 19's
 * `use` hook and refuses it outside a component.
 */
interface TestFixtures {
  alignedDice: undefined;
}

interface WorkerFixtures {
  api: APIRequestContext;
  scratchMatch: ScratchMatch;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  api: [
    async ({ playwright }, provide) => {
      const context = await playwright.request.newContext({ baseURL: API_ORIGIN });

      await provide(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  scratchMatch: [
    async ({ api }, provide) => {
      await provide(await openScratchMatch(api));
    },
    { scope: 'worker' },
  ],

  alignedDice: [
    async ({ api, scratchMatch }, provide) => {
      await alignDice(api, scratchMatch);
      await provide(undefined);
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
