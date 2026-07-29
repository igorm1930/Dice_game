import { expect, type Locator, type Page } from '@playwright/test';

import { type PlayerCredentials } from './api';

/**
 * The page, named the way a player would name it.
 *
 * Every locator here is role- or label-based, because the accessible name is the
 * thing the assignment actually asks to be right — a `data-testid` would pass
 * whether or not a screen reader could tell the two seats apart. The three
 * `getByTestId` calls are the exceptions, and each of them is for a number or a
 * banner that has no name of its own.
 *
 * **The strings are restated deliberately.** This suite drives the app from
 * outside, so it does not import `SEAT_LABELS` or the `sessionStorage` keys from
 * `src/`. A test that imported the constant it is asserting against would keep
 * passing after somebody renamed the button.
 */

export type SeatId = 'A' | 'B';

/** `SEAT_LABELS` in `src/lib/seats.ts`. */
const SEAT_LABEL: Readonly<Record<SeatId, string>> = { A: 'Seat A', B: 'Seat B' };

/**
 * `STORAGE_VERSION` and the keys in `src/lib/session-storage.ts`. Only the
 * refresh and turn-enforcement scenarios reach for these, and only to prove
 * something about the token the browser is *actually* holding.
 */
const SEAT_STORAGE_KEY: Readonly<Record<SeatId, string>> = {
  A: 'dice-game:v1:seat:A',
  B: 'dice-game:v1:seat:B',
};

const GAME_STORAGE_KEY = 'dice-game:v1:game';

/**
 * One seat's sign-in panel, at the top of the page.
 *
 * `exact` is not decoration. `getByRole`'s `name` is a **substring** match by
 * default, and once a match is on screen the page carries a second region called
 * "Seat A controls" — so the plain form resolves to two elements and every use
 * of this helper after `startMatch` dies of strict mode. The two accessible
 * names are genuinely distinct, which is what a rotor needs; it is the matcher
 * that needed telling.
 */
export function seatPanel(page: Page, seat: SeatId): Locator {
  return page.getByRole('region', { name: SEAT_LABEL[seat], exact: true });
}

/** One seat's Roll / Hold / New game panel, below the board. */
export function seatControls(page: Page, seat: SeatId): Locator {
  return page.getByRole('region', { name: `${SEAT_LABEL[seat]} controls`, exact: true });
}

/**
 * The seat-qualified buttons.
 *
 * Both seats render a "Roll", so each button's accessible name says which seat
 * it belongs to — see the comment on `CommandButton` in `seat-controls.tsx`.
 * Note that the name changes to "Rolling…, Seat A" while the request is in
 * flight, which is exactly what makes `expect(roll).toBeVisible()` a real wait
 * for the command to settle rather than a sleep.
 */
export function rollButton(page: Page, seat: SeatId): Locator {
  return page.getByRole('button', { name: `Roll, ${SEAT_LABEL[seat]}` });
}

export function holdButton(page: Page, seat: SeatId): Locator {
  return page.getByRole('button', { name: `Hold, ${SEAT_LABEL[seat]}` });
}

export function newGameButton(page: Page, seat: SeatId): Locator {
  return page.getByRole('button', { name: `New game, ${SEAT_LABEL[seat]}` });
}

export function signOutButton(page: Page, seat: SeatId): Locator {
  return page.getByRole('button', { name: `Sign out, ${SEAT_LABEL[seat]}` });
}

/** The points accumulated this turn. */
export function roundScore(page: Page): Locator {
  return page.getByTestId('round-score');
}

export function winnerBanner(page: Page): Locator {
  return page.getByTestId('winner-banner');
}

export function doubleSixCallout(page: Page): Locator {
  return page.getByTestId('double-six-callout');
}

/**
 * The polite live region — what a screen-reader user is told just happened.
 *
 * Narrowed by `aria-atomic`, because `role="status"` is also what the loading
 * blocks and the info alerts use, and "the first status on the page" would be
 * whichever of them happened to be mounted.
 */
export function announcement(page: Page): Locator {
  return page.locator('[role="status"][aria-atomic="true"]');
}

/** One die, by the face it is showing. Two dice are on the board at a time. */
export function dieShowing(page: Page, face: number): Locator {
  return page.getByRole('img', { name: `Die showing ${face}` });
}

export type Chair = 'First chair' | 'Second chair';

export function playerCard(page: Page, displayName: string, chair: Chair): Locator {
  return page.getByRole('article', { name: `${displayName}, ${chair}` });
}

/**
 * A number off a player's card.
 *
 * The card is a `<dl>` of `Score` and `Games won`; each pair sits in its own
 * wrapper, so filtering the wrappers by the term and taking the definition
 * reads the right number without depending on which one comes first.
 */
export function cardStat(card: Locator, label: 'Score' | 'Games won'): Locator {
  return card.locator('dl > div').filter({ hasText: label }).locator('dd');
}

/** Creates an account through the seat's own form and waits for it to take. */
export async function registerSeat(
  page: Page,
  seat: SeatId,
  player: PlayerCredentials,
): Promise<void> {
  const panel = seatPanel(page, seat);

  await panel.getByRole('button', { name: 'Create account' }).click();
  await panel.getByLabel('Email').fill(player.email);
  await panel.getByLabel('Display name').fill(player.displayName);
  await panel.getByLabel('Password').fill(player.password);
  await panel.getByRole('button', { name: `Create account for ${SEAT_LABEL[seat]}` }).click();

  await expect(signOutButton(page, seat)).toBeVisible();
}

/**
 * Puts two brand-new players in the two seats.
 *
 * **Seat B registers first, and the order is load-bearing.** The opponent picker
 * is `GET /api/users`, fetched with Seat A's token and keyed on Seat A's
 * identity, so it runs the moment Seat A signs in and nothing invalidates it
 * afterwards. Register Seat A first and the account created at Seat B a moment
 * later is not in the list that was already fetched — the picker offers nobody
 * to play against, and the only ways out are a refresh or a window blur.
 *
 * That is a defect in the client rather than in this suite: the panel should
 * refetch when the other seat signs in. It is recorded here because the order
 * below is the only reason these tests do not hit it, and somebody rearranging
 * them deserves to know why they suddenly cannot start a match.
 */
export async function seatBothPlayers(
  page: Page,
  players: { A: PlayerCredentials; B: PlayerCredentials },
): Promise<void> {
  await registerSeat(page, 'B', players.B);
  await registerSeat(page, 'A', players.A);
}

/** Signs an existing account into a seat through that seat's own form. */
export async function signInSeat(
  page: Page,
  seat: SeatId,
  player: PlayerCredentials,
): Promise<void> {
  const panel = seatPanel(page, seat);

  await panel.getByLabel('Email').fill(player.email);
  await panel.getByLabel('Password').fill(player.password);
  await panel.getByRole('button', { name: `Sign in as ${SEAT_LABEL[seat]}` }).click();

  await expect(signOutButton(page, seat)).toBeVisible();
}

/**
 * Starts the match. Seat A is always the creator — that is fixed in
 * `create-game-panel.tsx` so that "who created this" is never ambiguous on a
 * page with two identities.
 */
export async function startMatch(
  page: Page,
  options: { opponent: string; winningScore: number },
): Promise<void> {
  await page.getByLabel('Opponent').selectOption({ label: options.opponent });
  await page.getByLabel('Winning score').fill(String(options.winningScore));
  await page.getByRole('button', { name: 'Start match' }).click();

  await expect(roundScore(page)).toBeVisible();
}

/** The access token this browser is holding for a seat, straight out of storage. */
export async function storedToken(page: Page, seat: SeatId): Promise<string> {
  const raw = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    SEAT_STORAGE_KEY[seat],
  );

  if (raw === null) {
    throw new Error(`${SEAT_LABEL[seat]} has no stored session; is it signed in?`);
  }

  return (JSON.parse(raw) as { accessToken: string }).accessToken;
}

export async function storedGameId(page: Page): Promise<string> {
  const gameId = await page.evaluate((key) => window.sessionStorage.getItem(key), GAME_STORAGE_KEY);

  if (gameId === null) {
    throw new Error('No match id in storage; has one been started?');
  }

  return gameId;
}
