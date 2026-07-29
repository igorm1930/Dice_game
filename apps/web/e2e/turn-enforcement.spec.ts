import { expect, test } from './fixtures';
import { attemptRoll, fetchGame, newPlayer } from './support/api';
import {
  holdButton,
  rollButton,
  roundScore,
  seatBothPlayers,
  seatControls,
  startMatch,
  storedGameId,
  storedToken,
} from './support/board';
import { roundScoreAfter } from './support/dice';

/**
 * Whose turn it is, and who decides.
 *
 * A disabled button is a courtesy. This scenario asserts the courtesy *and* what
 * is underneath it, in three steps:
 *
 *  1. Seat B's Roll is disabled while it is Seat A's turn.
 *  2. The two seats' tokens get different answers from the same endpoint —
 *     `canRoll` is true for one and false for the other — so the button state is
 *     a boolean that arrived over the wire, not one this client worked out.
 *  3. The request that button would have made, sent with Seat B's own token,
 *     comes back 403 `NOT_YOUR_TURN` and leaves the game exactly where it was.
 *     A modified client cannot take a turn that is not its own.
 *
 * Step 3 is the one that would survive a rewrite of the frontend, which is why
 * it is here rather than in the jsdom suite.
 */
const WINNING_SCORE = 100;

test('seat B cannot roll on seat A’s turn, and the refusal comes from the server', async ({
  page,
  api,
}) => {
  const ada = newPlayer('Ada');
  const grace = newPlayer('Grace');

  const rollRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().endsWith('/roll')) {
      rollRequests.push(request.url());
    }
  });

  await page.goto('/');
  await seatBothPlayers(page, { A: ada, B: grace });
  await startMatch(page, { opponent: grace.displayName, winningScore: WINNING_SCORE });

  // ---- 1. what the player sees ------------------------------------------
  await expect(rollButton(page, 'A')).toBeEnabled();
  await expect(rollButton(page, 'B')).toBeDisabled();
  await expect(holdButton(page, 'B')).toBeDisabled();

  // ---- 2. where that came from ------------------------------------------
  const gameId = await storedGameId(page);
  const adaToken = await storedToken(page, 'A');
  const graceToken = await storedToken(page, 'B');

  const asAda = await fetchGame(api, adaToken, gameId);
  const asGrace = await fetchGame(api, graceToken, gameId);

  expect(asAda.viewerSeat).toBe(0);
  expect(asGrace.viewerSeat).toBe(1);
  expect(asAda.availableActions.canRoll).toBe(true);
  expect(asGrace.availableActions.canRoll).toBe(false);
  expect(asGrace.availableActions.canHold).toBe(false);

  // ---- 3a. tampering with the DOM does not even get a request out --------
  //
  // Turning the `disabled` attribute off and clicking dispatches a real click —
  // `native` below is the count seen by a listener on the button itself — but
  // React decides whether to run `onClick` from the props in its own fiber, not
  // from the attribute, and its props still say the control is disabled. So the
  // event bubbles into React and is dropped.
  //
  // `native` is asserted because without it "no request was sent" would also be
  // satisfied by a click that never happened, which is no evidence at all.
  const native = await rollButton(page, 'B').evaluate((element) => {
    const button = element as HTMLButtonElement;
    let clicks = 0;

    button.addEventListener('click', () => {
      clicks += 1;
    });

    button.disabled = false;
    button.click();

    return clicks;
  });

  expect(native).toBe(1);

  // There is no event to wait for here — the claim is that one never happens —
  // so this is a bounded pause rather than a poll. A second is many times over
  // the round trip the same click makes from Seat A.
  await page.waitForTimeout(1000);
  expect(rollRequests).toEqual([]);

  // ---- 3b. so make the request the button would have made ----------------
  //
  // Seat B's real token, straight out of the browser's `sessionStorage`, and the
  // revision the browser is holding: this is the client lying, with nothing left
  // between it and the API to be talked out of it.
  const refusal = await attemptRoll(api, graceToken, gameId, asGrace.revision);
  const failure = (await refusal.json()) as { error: { code: string } };

  expect(refusal.status()).toBe(403);
  expect(failure.error.code).toBe('NOT_YOUR_TURN');

  // ---- 3c. and the game did not move ------------------------------------
  const afterwards = await fetchGame(api, adaToken, gameId);

  expect(afterwards.revision).toBe(asAda.revision);
  expect(afterwards.lastDice).toBeNull();
  expect(afterwards.activePlayer).toBe(0);

  // The board is where it was, and neither seat was shown anything: none of this
  // reached the page, which is the whole point of 3a.
  //
  // Scoped to the two control panels rather than to the page, because Next.js's
  // App Router mounts a `next-route-announcer` of its own — an empty
  // `role="alert"` that lives outside the app root and is present on every page.
  // `page.getByRole('alert')` can therefore never be 0, so the unscoped form
  // would be an assertion that fails whatever the app does.
  await expect(roundScore(page)).toHaveText('0');
  await expect(seatControls(page, 'A').getByRole('alert')).toHaveCount(0);
  await expect(seatControls(page, 'B').getByRole('alert')).toHaveCount(0);

  // ---- and the same listener does see a roll that is allowed ------------
  //
  // `rollRequests` being empty in 3a would be just as satisfied by a listener
  // that never fires at all, which would make the interesting assertion in this
  // file assert nothing. Seat A's turn is real, so its click has to show up on
  // the same list, through the same filter, to prove the empty one meant it.
  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));

  expect(rollRequests).toHaveLength(1);
});
