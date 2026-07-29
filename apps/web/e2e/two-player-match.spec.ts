import path from 'node:path';

import { expect, test } from './fixtures';
import { newPlayer } from './support/api';
import {
  announcement,
  cardStat,
  dieShowing,
  holdButton,
  newGameButton,
  playerCard,
  rollButton,
  roundScore,
  seatBothPlayers,
  startMatch,
  winnerBanner,
} from './support/board';
import { roundScoreAfter } from './support/dice';

/**
 * The assignment, end to end, in one browser tab.
 *
 * Two people register, sit down at the two seats, and play a match out to a win
 * and into the next game. Everything asserted here is a number or a sentence the
 * API sent: the round score the dice imply, the banked score after a hold, whose
 * turn it is, who won, and — the one that matters after New Game — that the win
 * count survived while the scores did not.
 *
 * The winning score is 10, which is `MIN_WINNING_SCORE`: the first two throws of
 * the deterministic script bank 3+4 and then 1+2, so a match is decided in a
 * handful of clicks without scripting a dozen rounds and without asking for a
 * target no real game would allow.
 */
const WINNING_SCORE = 10;

/** Committed, and referenced from the README — there is no live URL to link. */
const SCREENSHOT = path.join(__dirname, 'artifacts', 'match-in-progress.png');

test('two seats play a match out to a win, and the win count survives the next game', async ({
  page,
}) => {
  const ada = newPlayer('Ada');
  const grace = newPlayer('Grace');

  await page.goto('/');

  // Two accounts, two panels, two tokens. Neither seat knows about the other's.
  await seatBothPlayers(page, { A: ada, B: grace });

  await startMatch(page, { opponent: grace.displayName, winningScore: WINNING_SCORE });

  const adaCard = playerCard(page, ada.displayName, 'First chair');
  const graceCard = playerCard(page, grace.displayName, 'Second chair');

  await expect(page.getByRole('heading', { name: 'Game 1' })).toBeVisible();
  await expect(cardStat(adaCard, 'Score')).toHaveText('0');
  await expect(cardStat(graceCard, 'Score')).toHaveText('0');

  // The creator moves first, and it is the server that says so: Ada's view came
  // back with `canRoll` true and Grace's with it false.
  await expect(rollButton(page, 'A')).toBeEnabled();
  await expect(rollButton(page, 'B')).toBeDisabled();

  // ---- Ada rolls [3, 4] ------------------------------------------------
  await rollButton(page, 'A').click();

  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));
  await expect(dieShowing(page, 3)).toBeVisible();
  await expect(dieShowing(page, 4)).toBeVisible();
  await expect(announcement(page)).toContainText(
    `${ada.displayName} rolled 3 and 4. Round score ${roundScoreAfter(0)}.`,
  );

  // ---- and banks it ----------------------------------------------------
  await holdButton(page, 'A').click();

  await expect(cardStat(adaCard, 'Score')).toHaveText(String(roundScoreAfter(0)));
  await expect(roundScore(page)).toHaveText('0');
  await expect(announcement(page)).toContainText(
    `Round score banked. It is now ${grace.displayName}’s turn to roll.`,
  );

  // The dice really did pass: both buttons flipped, and neither of them asked
  // this client whose turn it was.
  await expect(rollButton(page, 'A')).toBeDisabled();
  await expect(rollButton(page, 'B')).toBeEnabled();

  // ---- Grace rolls [1, 2] and banks 3 ----------------------------------
  await rollButton(page, 'B').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(1)));

  await holdButton(page, 'B').click();
  await expect(cardStat(graceCard, 'Score')).toHaveText(String(roundScoreAfter(1)));
  await expect(rollButton(page, 'A')).toBeEnabled();

  // ---- Ada rolls [5, 2], which will take her past 10 --------------------
  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(2)));

  // The match at its most legible: both seats signed in, both scores on the
  // board, the dice showing the throw that is about to win it.
  await page.screenshot({ path: SCREENSHOT, fullPage: true });

  await holdButton(page, 'A').click();

  // ---- the win ---------------------------------------------------------
  const total = roundScoreAfter(0) + roundScoreAfter(2);

  await expect(winnerBanner(page)).toContainText(`${ada.displayName} wins game 1`);
  await expect(announcement(page)).toContainText(`${ada.displayName} wins game 1.`);
  await expect(cardStat(adaCard, 'Score')).toHaveText(String(total));
  await expect(cardStat(adaCard, 'Games won')).toHaveText('1');
  expect(total).toBeGreaterThanOrEqual(WINNING_SCORE);

  // Nobody may roll a finished game, and the server is what refuses.
  await expect(rollButton(page, 'A')).toBeDisabled();
  await expect(rollButton(page, 'B')).toBeDisabled();

  // ---- and the next game in the series ---------------------------------
  await newGameButton(page, 'A').click();

  await expect(page.getByRole('heading', { name: 'Game 2' })).toBeVisible();
  await expect(winnerBanner(page)).toHaveCount(0);
  await expect(roundScore(page)).toHaveText('0');
  await expect(cardStat(adaCard, 'Score')).toHaveText('0');
  await expect(cardStat(graceCard, 'Score')).toHaveText('0');

  // The point of the whole scenario: the series remembers.
  await expect(cardStat(adaCard, 'Games won')).toHaveText('1');
  await expect(cardStat(graceCard, 'Games won')).toHaveText('0');
  await expect(rollButton(page, 'A')).toBeEnabled();
});
