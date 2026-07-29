import { expect, test } from './fixtures';
import { newPlayer } from './support/api';
import {
  announcement,
  dieShowing,
  doubleSixCallout,
  holdButton,
  rollButton,
  roundScore,
  seatBothPlayers,
  seatControls,
  startMatch,
} from './support/board';
import { roundScoreAfter } from './support/dice';

/**
 * The bust.
 *
 * The fourth throw of the deterministic script is `[6, 6]`, so three rolls build
 * a round score worth losing and the fourth loses it. What is asserted is the
 * server's account of it — round score zero, the dice passed, `effect` rendered
 * as words — plus the one piece of behaviour that has no server field behind it:
 * the animation pause.
 *
 * That pause is a local timer (`use-double-six-pause.ts`), and it decides
 * nothing; the transition already happened. It exists so a player sees the throw
 * that cost them the round. The way to wait for it is to wait for the button to
 * come back, never to sleep.
 */
const WINNING_SCORE = 100;

test('a double six wipes the round score, passes the dice, and stills the board', async ({
  page,
}) => {
  const ada = newPlayer('Ada');
  const grace = newPlayer('Grace');

  await page.goto('/');
  await seatBothPlayers(page, { A: ada, B: grace });
  await startMatch(page, { opponent: grace.displayName, winningScore: WINNING_SCORE });

  // Three throws, worth 17 between them, all Ada's — a normal roll does not pass
  // the dice, so she keeps them until she busts or holds.
  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0)));

  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0, 1)));

  await rollButton(page, 'A').click();
  await expect(roundScore(page)).toHaveText(String(roundScoreAfter(0, 1, 2)));

  // ---- the fourth throw is [6, 6] --------------------------------------
  await rollButton(page, 'A').click();

  await expect(doubleSixCallout(page)).toBeVisible();

  // Grace's own view has arrived and says the dice are hers; her Roll is still
  // shut, and the only thing shutting it now is the animation. Asserting the
  // turn first is what makes this about the pause rather than about a view that
  // had not refreshed yet.
  await expect(seatControls(page, 'B')).toContainText('Your turn.');
  expect(await rollButton(page, 'B').isDisabled()).toBe(true);
  expect(await holdButton(page, 'B').isDisabled()).toBe(true);

  // ...and then it lets go. Waited for, not slept through.
  await expect(rollButton(page, 'B')).toBeEnabled();

  // ---- what the server said happened ------------------------------------
  await expect(roundScore(page)).toHaveText('0');
  await expect(dieShowing(page, 6)).toHaveCount(2);
  await expect(doubleSixCallout(page)).toContainText(
    `Double six — the round score was lost. Next to roll: ${grace.displayName}.`,
  );
  await expect(announcement(page)).toContainText(
    `Double six. The round score is lost and the dice pass to ${grace.displayName}.`,
  );

  // The dice are Grace's, so Ada may not roll — and it is not the pause saying
  // so any more, because the pause is over.
  await expect(rollButton(page, 'A')).toBeDisabled();
  await expect(seatControls(page, 'A')).toContainText(`Waiting for ${grace.displayName}.`);
});
