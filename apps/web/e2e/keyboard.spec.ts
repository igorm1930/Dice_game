import { expect, test } from './fixtures';
import { registerPlayer } from './support/api';
import { dieShowing, roundScore, signOutButton, startMatch } from './support/board';
import { roundScoreAfter } from './support/dice';
import { focused, focusRing, tabUntil } from './support/keyboard';

/**
 * A player who never touches the mouse.
 *
 * Accessibility was a stated requirement, and this is the only place it can be
 * checked for real: jsdom has no layout, so it cannot tell whether a focused
 * control is *visibly* focused, and `:focus-visible` — which is what decides
 * whether the ring is drawn at all — does not exist there either.
 *
 * The two accounts are created over the API on purpose. What is being tested is
 * signing **in** and rolling by keyboard; registering by keyboard as well would
 * only be the same four fields again. Starting the match is setup too, and the
 * spec says so where it happens.
 */
const WINNING_SCORE = 100;

/** A ring nobody can see is not a focus indicator. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test('a keyboard-only player can sign in, see where they are, and roll', async ({ page, api }) => {
  const ada = await registerPlayer(api, 'Ada');
  const grace = await registerPlayer(api, 'Grace');

  await page.goto('/');

  // ---- Seat A signs in, by keyboard alone -------------------------------
  await tabUntil(page, 'Seat A’s email field', (element) => element.id === 'seat-a-email');

  const emailRing = await focusRing(page);

  expect(emailRing.style).toBe('solid');
  expect(emailRing.width).toBeGreaterThanOrEqual(3);
  expect(emailRing.color).not.toBe(TRANSPARENT);

  await page.keyboard.type(ada.email);
  await page.keyboard.press('Tab');

  // The next stop is the password field: the tab order follows the form.
  expect((await focused(page)).id).toBe('seat-a-password');

  await page.keyboard.type(ada.password);
  // Submitted from the field, not by tabbing on to the button — the ordinary
  // way a keyboard user finishes a form.
  await page.keyboard.press('Enter');

  await expect(signOutButton(page, 'A')).toBeVisible();

  // ---- Seat B signs in, from wherever signing in left focus --------------
  await tabUntil(page, 'Seat B’s email field', (element) => element.id === 'seat-b-email');

  await page.keyboard.type(grace.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(grace.password);
  await page.keyboard.press('Enter');

  await expect(signOutButton(page, 'B')).toBeVisible();

  // Starting the match is setup for the roll below, so it is not done by
  // keyboard; the seat panels above and the Roll below are the subject.
  await startMatch(page, { opponent: grace.displayName, winningScore: WINNING_SCORE });

  // ---- and rolls, by keyboard alone -------------------------------------
  await tabUntil(page, 'Seat A’s Roll button', (element) => element.ariaLabel === 'Roll, Seat A');

  const rollRing = await focusRing(page);

  expect(rollRing.style).toBe('solid');
  expect(rollRing.width).toBeGreaterThanOrEqual(3);
  expect(rollRing.color).not.toBe(TRANSPARENT);

  await page.keyboard.press('Enter');

  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));
  await expect(dieShowing(page, 3)).toBeVisible();
  await expect(dieShowing(page, 4)).toBeVisible();

  // Focus is still somewhere useful afterwards. Rolling leaves the dice with the
  // same player, so the button the keyboard user was standing on is still theirs
  // — being thrown back to the top of the document here is the defect
  // `useReturnFocusAfterActing` exists to prevent.
  expect((await focused(page)).tagName).not.toBe('BODY');
});
