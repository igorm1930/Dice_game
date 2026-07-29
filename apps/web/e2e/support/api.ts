import { type AuthSession, type GameView, ROUTES } from '@dice-game/contracts';
import { type APIRequestContext, type APIResponse } from '@playwright/test';

/**
 * Talking to the API directly, for the parts of a scenario that are setup
 * rather than subject.
 *
 * Two things need this. Registering an account the keyboard test is about to
 * *sign in* to is one; the other is `dice.ts`, which has to advance the API's
 * scripted dice to a known point before a test starts. Neither is something the
 * browser should be doing, and neither is what the test is asserting.
 *
 * No path is written here. `ROUTES` is the same table the client uses, so a
 * renamed endpoint breaks this file at compile time rather than at 404.
 */

export interface PlayerCredentials {
  email: string;
  displayName: string;
  password: string;
}

export interface RegisteredPlayer extends PlayerCredentials {
  userId: string;
  accessToken: string;
}

/**
 * Fresh credentials, every time.
 *
 * The e2e database is emptied before a run, not between tests, and a test that
 * reused an email would get `EMAIL_TAKEN` from whichever test ran first. The
 * display name carries the same suffix because it is what the tests locate
 * player cards by, and two cards reading "Seat A" would be ambiguous.
 */
export function newPlayer(label: string): PlayerCredentials {
  const unique = crypto.randomUUID().slice(0, 8);

  return {
    email: `${label}-${unique}@dice-game.test`,
    displayName: `${label} ${unique}`,
    password: 'correct-horse-battery-staple',
  };
}

async function payloadOf(response: APIResponse, what: string): Promise<unknown> {
  if (!response.ok()) {
    throw new Error(`${what} answered ${response.status()}: ${await response.text()}`);
  }

  const envelope = (await response.json()) as { data: unknown };

  return envelope.data;
}

/** Creates an account and returns it together with the token the API minted. */
export async function registerPlayer(
  api: APIRequestContext,
  label: string,
): Promise<RegisteredPlayer> {
  const credentials = newPlayer(label);
  const session = (await payloadOf(
    await api.post(ROUTES.auth.register, { data: credentials }),
    `register ${credentials.email}`,
  )) as AuthSession;

  return { ...credentials, userId: session.user.id, accessToken: session.accessToken };
}

export async function createGame(
  api: APIRequestContext,
  token: string,
  opponentId: string,
  winningScore: number,
): Promise<GameView> {
  return (await payloadOf(
    await api.post(ROUTES.games.create, {
      headers: { Authorization: `Bearer ${token}` },
      data: { opponentId, winningScore },
    }),
    'create game',
  )) as GameView;
}

export async function fetchGame(
  api: APIRequestContext,
  token: string,
  gameId: string,
): Promise<GameView> {
  return (await payloadOf(
    await api.get(ROUTES.games.byId(gameId), {
      headers: { Authorization: `Bearer ${token}` },
    }),
    'read game',
  )) as GameView;
}

/**
 * Rolls on behalf of whoever holds `token` and hands back the raw response,
 * refusal and all.
 *
 * {@link rollAs} throws on anything that is not 2xx, which is right for setup —
 * a scratch roll that failed should not be reported three assertions later. This
 * one is for the scenario where the refusal *is* the subject.
 */
export async function attemptRoll(
  api: APIRequestContext,
  token: string,
  gameId: string,
  expectedRevision: number,
): Promise<APIResponse> {
  return api.post(ROUTES.games.roll(gameId), {
    headers: { Authorization: `Bearer ${token}` },
    data: { expectedRevision },
  });
}

/** Rolls on behalf of whoever holds `token`. Returns the resulting view. */
export async function rollAs(
  api: APIRequestContext,
  token: string,
  view: GameView,
): Promise<GameView> {
  return (await payloadOf(
    await api.post(ROUTES.games.roll(view.id), {
      headers: { Authorization: `Bearer ${token}` },
      data: { expectedRevision: view.revision },
    }),
    'roll',
  )) as GameView;
}
