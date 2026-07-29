import {
  DEFAULT_WINNING_SCORE,
  MAX_WINNING_SCORE,
  MIN_WINNING_SCORE,
  ROUTES,
  type UserSummary,
} from '@dice-game/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  deferred,
  fail,
  type FakeApi,
  type FakeResponse,
  installFakeApi,
  ok,
} from '@/test/fake-api';
import {
  ADA,
  authSession,
  GAME_ID,
  gameView,
  GRACE,
  LINUS,
  TOKEN_A,
  TOKEN_B,
} from '@/test/fixtures';
import { renderPage, seatAlreadySignedIn } from '@/test/render';

/** Both seats restored from storage, and the opponent list served. */
function bothSeatsSignedIn(api: FakeApi): void {
  const byToken: Readonly<Record<string, UserSummary>> = { [TOKEN_A]: ADA, [TOKEN_B]: GRACE };

  api.route('GET', ROUTES.auth.me, (request) => {
    const user = request.token === null ? undefined : byToken[request.token];

    return user === undefined
      ? fail('UNAUTHENTICATED')
      : ok({ ...user, email: `${user.displayName.toLowerCase()}@example.com` });
  });

  api.route('GET', ROUTES.users.list, () =>
    ok({ items: [ADA, GRACE, LINUS], total: 3, limit: 25, offset: 0, hasMore: false }),
  );

  seatAlreadySignedIn('A', ADA, TOKEN_A);
  seatAlreadySignedIn('B', GRACE, TOKEN_B);
}

function form() {
  return within(screen.getByRole('region', { name: 'Start a match' }));
}

describe('starting a match', () => {
  it('offers the opponents the API listed, minus the creator', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);

    renderPage();

    expect(await screen.findByRole('option', { name: 'Grace' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Linus' })).toBeInTheDocument();
    // Ada is Seat A, the creator. The server would answer INVALID_OPPONENT.
    expect(screen.queryByRole('option', { name: 'Ada' })).not.toBeInTheDocument();
  });

  /**
   * The roster is fetched once, with Seat A's token, the moment Seat A signs in.
   * Nothing invalidated it afterwards — so a reviewer who creates an account at
   * Seat A and *then* one at Seat B was offered an empty picker and had no way
   * forward but a refresh. The order that happens to work (B before A) is the
   * order the e2e suite uses, which is exactly why this went unnoticed.
   */
  it('picks up a player who signed in at the other seat after the list was fetched', async () => {
    const api = installFakeApi();
    const roster: UserSummary[] = [ADA];

    api.route('GET', ROUTES.auth.me, (request) =>
      request.token === TOKEN_A
        ? ok({ ...ADA, email: 'ada@example.com' })
        : fail('UNAUTHENTICATED'),
    );

    api.route('GET', ROUTES.users.list, () =>
      ok({ items: [...roster], total: roster.length, limit: 25, offset: 0, hasMore: false }),
    );

    // Grace exists only from the moment she signs in, as she would in reality.
    api.route('POST', ROUTES.auth.login, () => {
      if (!roster.includes(GRACE)) {
        roster.push(GRACE);
      }

      return ok(authSession(GRACE, TOKEN_B));
    });

    seatAlreadySignedIn('A', ADA, TOKEN_A);

    const { user } = renderPage();

    // Ada is alone: the picker has nobody to offer.
    expect(await screen.findByText(/yours is the only account/i)).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Grace' })).not.toBeInTheDocument();

    const seatB = within(screen.getByRole('region', { name: 'Seat B' }));

    await user.type(seatB.getByLabelText('Email'), 'grace@example.com');
    await user.type(seatB.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(seatB.getByRole('button', { name: 'Sign in as Seat B' }));

    expect(await screen.findByRole('option', { name: 'Grace' })).toBeInTheDocument();
  });

  it('takes its winning-score bounds and default from the contract', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);

    renderPage();

    const winningScore = await screen.findByLabelText('Winning score');
    expect(winningScore).toHaveAttribute('min', String(MIN_WINNING_SCORE));
    expect(winningScore).toHaveAttribute('max', String(MAX_WINNING_SCORE));
    expect(winningScore).toHaveValue(DEFAULT_WINNING_SCORE);
  });

  it('sends the chosen opponent and score, then shows the board', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);
    api.route('POST', ROUTES.games.create, () => ok(gameView({ winningScore: 50 }), 201));
    api.route('GET', ROUTES.games.byId(GAME_ID), (request) =>
      ok(gameView({ winningScore: 50, viewerSeat: request.token === TOKEN_A ? 0 : 1 })),
    );

    const { user } = renderPage();

    await screen.findByRole('option', { name: 'Grace' });
    await user.selectOptions(form().getByLabelText('Opponent'), GRACE.id);
    await user.clear(form().getByLabelText('Winning score'));
    await user.type(form().getByLabelText('Winning score'), '50');
    await user.click(form().getByRole('button', { name: 'Start match' }));

    expect(await screen.findByRole('region', { name: 'Game 1' })).toBeInTheDocument();

    const created = api.callsTo('POST', ROUTES.games.create);
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toEqual({ opponentId: GRACE.id, winningScore: 50 });
    // Created by Seat A, with Seat A's token.
    expect(created[0]?.token).toBe(TOKEN_A);
  });

  it('shows a pending state while the match is being created', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);

    const pending = deferred<FakeResponse>();
    api.route('POST', ROUTES.games.create, () => pending.promise);
    api.route('GET', ROUTES.games.byId(GAME_ID), () => ok(gameView()));

    const { user } = renderPage();

    await screen.findByRole('option', { name: 'Grace' });
    await user.selectOptions(form().getByLabelText('Opponent'), GRACE.id);
    await user.click(form().getByRole('button', { name: 'Start match' }));

    const starting = await screen.findByRole('button', { name: 'Starting…' });
    expect(starting).toBeDisabled();

    pending.resolve(ok(gameView(), 201));
    expect(await screen.findByRole('region', { name: 'Game 1' })).toBeInTheDocument();
  });

  it('surfaces a rejection from the server', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);
    api.route('POST', ROUTES.games.create, () => fail('INVALID_OPPONENT'));

    const { user } = renderPage();

    await screen.findByRole('option', { name: 'Grace' });
    await user.selectOptions(form().getByLabelText('Opponent'), GRACE.id);
    await user.click(form().getByRole('button', { name: 'Start match' }));

    const alert = await form().findByRole('alert');
    expect(alert).toHaveTextContent('you cannot play against yourself');
    expect(alert).toHaveTextContent('INVALID_OPPONENT');
  });

  it('says what to do when the creator is the only account, instead of offering an empty picker', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);
    // First run: one account exists, and it is the creator's. Filtering the
    // creator out leaves the picker holding nothing but its placeholder.
    api.route('GET', ROUTES.users.list, () =>
      ok({ items: [ADA], total: 1, limit: 25, offset: 0, hasMore: false }),
    );

    renderPage();

    expect(
      await screen.findByText(/yours is the only account on this server/i),
    ).toBeInTheDocument();

    // No picker to get stuck in, and no submit to press. The old hint about
    // needing two accounts appeared only while Seat A was signed out — which is
    // to say it vanished exactly when somebody needed it.
    expect(screen.queryByLabelText('Opponent')).not.toBeInTheDocument();
    expect(form().getByRole('button', { name: 'Start match' })).toBeDisabled();
  });

  it('reports a user list that could not be loaded, and offers a retry', async () => {
    const api = installFakeApi();
    bothSeatsSignedIn(api);
    api.route('GET', ROUTES.users.list, () => fail('RATE_LIMIT_EXCEEDED'));

    renderPage();

    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(form().getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });
});
