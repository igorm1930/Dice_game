import { expect, test } from './fixtures';
import { newPlayer } from './support/api';
import {
  dieShowing,
  playerCard,
  rollButton,
  roundScore,
  seatBothPlayers,
  seatPanel,
  signOutButton,
  startMatch,
} from './support/board';
import { roundScoreAfter } from './support/dice';

/**
 * F5, mid-match.
 *
 * Two seats share one page, so a refresh that signed both of them out would make
 * the whole arrangement unusable in practice. Each seat's token lives in
 * `sessionStorage` — one tab, deliberately not `localStorage` — and is offered
 * back to `GET /api/auth/me` on load, because a token that survived a refresh is
 * only a string: it may have expired, and signing out anywhere bumps the user's
 * `tokenVersion` and revokes it.
 *
 * The match id is stored alongside the tokens, which is why this comes back to
 * the board rather than to an empty lobby.
 */
const WINNING_SCORE = 100;

test('a refresh keeps both seats signed in and the match on screen', async ({ page }) => {
  const ada = newPlayer('Ada');
  const grace = newPlayer('Grace');

  await page.goto('/');
  await seatBothPlayers(page, { A: ada, B: grace });
  await startMatch(page, { opponent: grace.displayName, winningScore: WINNING_SCORE });

  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));

  await page.reload();

  // Both seats are still themselves, each with its own restored token.
  await expect(signOutButton(page, 'A')).toBeVisible();
  await expect(signOutButton(page, 'B')).toBeVisible();
  await expect(seatPanel(page, 'A')).toContainText(ada.displayName);
  await expect(seatPanel(page, 'B')).toContainText(grace.displayName);

  // And the board came back, rather than the lobby.
  await expect(page.getByRole('heading', { name: 'Game 1' })).toBeVisible();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));
  await expect(dieShowing(page, 3)).toBeVisible();
  await expect(dieShowing(page, 4)).toBeVisible();
  await expect(playerCard(page, ada.displayName, 'First chair')).toBeVisible();
  await expect(playerCard(page, grace.displayName, 'Second chair')).toBeVisible();

  // The turn survived too, and it was fetched with the reloaded tokens.
  await expect(rollButton(page, 'A')).toBeEnabled();
  await expect(rollButton(page, 'B')).toBeDisabled();
});
