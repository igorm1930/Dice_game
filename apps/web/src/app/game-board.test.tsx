import { type GameView, ROUTES, type UserSummary } from '@dice-game/contracts';
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
  ACTIVE_ACTIONS,
  ADA,
  GAME_ID,
  gameView,
  GRACE,
  NO_ACTIONS,
  TOKEN_A,
  TOKEN_B,
} from '@/test/fixtures';
import { matchAlreadyChosen, renderPage, seatAlreadySignedIn } from '@/test/render';

/**
 * The board.
 *
 * Every assertion here is about rendering what the server said. The important
 * one is the disabled Roll: it is disabled because `availableActions.canRoll`
 * arrived as `false`, not because the test set up a position in which rolling
 * would be illegal — the client has no idea what those positions are.
 */

const GAME_PATH = ROUTES.games.byId(GAME_ID);

/** Both seats signed in, a match already chosen, and a per-token view served. */
function seatedAtBoard(api: FakeApi, viewFor: (token: string | null) => GameView): void {
  const byToken: Readonly<Record<string, UserSummary>> = { [TOKEN_A]: ADA, [TOKEN_B]: GRACE };

  api.route('GET', ROUTES.auth.me, (request) => {
    const user = request.token === null ? undefined : byToken[request.token];

    return user === undefined
      ? fail('UNAUTHENTICATED')
      : ok({ ...user, email: `${user.displayName.toLowerCase()}@example.com` });
  });

  api.route('GET', GAME_PATH, (request) => ok(viewFor(request.token)));

  seatAlreadySignedIn('A', ADA, TOKEN_A);
  seatAlreadySignedIn('B', GRACE, TOKEN_B);
  matchAlreadyChosen(GAME_ID);
}

function controls(seat: 'A' | 'B') {
  return within(screen.getByRole('region', { name: `Seat ${seat} controls` }));
}

function card(name: string) {
  return within(screen.getByRole('article', { name }));
}

describe('rendering what the server sent', () => {
  it('shows each player’s score and win count', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () =>
      gameView({
        players: [
          { userId: ADA.id, displayName: ADA.displayName, globalScore: 42, winCount: 2 },
          { userId: GRACE.id, displayName: GRACE.displayName, globalScore: 17, winCount: 1 },
        ],
        roundScore: 9,
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(card('Ada, First chair').getByText('42')).toBeInTheDocument();
    expect(card('Ada, First chair').getByText('2')).toBeInTheDocument();
    expect(card('Grace, Second chair').getByText('17')).toBeInTheDocument();
    expect(card('Grace, Second chair').getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('round-score')).toHaveTextContent('9');
  });

  it('marks the active player the server named, and only that player', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) =>
      gameView({
        activePlayer: 1,
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions: token === TOKEN_A ? NO_ACTIONS : ACTIVE_ACTIONS,
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(card('Grace, Second chair').getByText('Their turn')).toBeInTheDocument();
    expect(card('Ada, First chair').queryByText('Their turn')).not.toBeInTheDocument();
    expect(controls('A').getByText('Waiting for Grace.')).toBeInTheDocument();
    expect(controls('B').getByText('Your turn.')).toBeInTheDocument();
  });

  it('shows each seat which chair it is sitting in, from viewerSeat', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) => gameView({ viewerSeat: token === TOKEN_A ? 0 : 1 }));

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(card('Ada, First chair').getByText(/Seat A/)).toBeInTheDocument();
    expect(card('Grace, Second chair').getByText(/Seat B/)).toBeInTheDocument();
  });

  it('fetches the board once per seat, each with that seat’s own token', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) => gameView({ viewerSeat: token === TOKEN_A ? 0 : 1 }));

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    await waitFor(() => {
      const tokens = api.callsTo('GET', GAME_PATH).map((call) => call.token);
      expect(new Set(tokens)).toEqual(new Set([TOKEN_A, TOKEN_B]));
    });
  });
});

describe('button state', () => {
  it('disables Roll because the server said canRoll is false — not because the client decided', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) =>
      gameView({
        activePlayer: 1,
        viewerSeat: token === TOKEN_A ? 0 : 1,
        // The only difference between the two seats is what the server allows
        // each of them to do.
        availableActions: token === TOKEN_A ? NO_ACTIONS : ACTIVE_ACTIONS,
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(controls('A').getByRole('button', { name: 'Roll' })).toBeDisabled();
    expect(controls('A').getByRole('button', { name: 'Hold' })).toBeDisabled();
    expect(controls('B').getByRole('button', { name: 'Roll' })).toBeEnabled();
    expect(controls('B').getByRole('button', { name: 'Hold' })).toBeEnabled();
  });

  it('disables New game when the server says the seat may not start one', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () =>
      gameView({ availableActions: { canRoll: true, canHold: true, canStartNewGame: false } }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(controls('A').getByRole('button', { name: 'New game' })).toBeDisabled();
  });

  it('sends the revision of the view it is showing', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView({ revision: 11 }));
    api.route('POST', ROUTES.games.roll(GAME_ID), () => ok(gameView({ revision: 12 })));

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(controls('A').getByRole('button', { name: 'Roll' }));

    await waitFor(() => {
      expect(api.callsTo('POST', ROUTES.games.roll(GAME_ID))).toHaveLength(1);
    });

    const rolled = api.callsTo('POST', ROUTES.games.roll(GAME_ID))[0];
    expect(rolled?.body).toEqual({ expectedRevision: 11 });
    expect(rolled?.token).toBe(TOKEN_A);
  });

  it('banks the round with Hold, and refreshes both seats afterwards', async () => {
    const api = installFakeApi();

    // The fake keeps the state the command produced, so the refetch that
    // follows returns the new board rather than the old one.
    let current = (token: string | null): GameView =>
      gameView({ revision: 4, roundScore: 13, viewerSeat: token === TOKEN_A ? 0 : 1 });

    seatedAtBoard(api, (token) => current(token));

    api.route('POST', ROUTES.games.hold(GAME_ID), () => {
      current = (token) =>
        gameView({
          revision: 5,
          roundScore: 0,
          activePlayer: 1,
          effect: 'HELD',
          viewerSeat: token === TOKEN_A ? 0 : 1,
        });

      return ok(current(TOKEN_A));
    });

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    const fetchesBefore = api.callsTo('GET', GAME_PATH).length;

    await user.click(controls('A').getByRole('button', { name: 'Hold' }));

    await waitFor(() => {
      expect(api.callsTo('POST', ROUTES.games.hold(GAME_ID))).toHaveLength(1);
    });

    expect(api.callsTo('POST', ROUTES.games.hold(GAME_ID))[0]?.body).toEqual({
      expectedRevision: 4,
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Round score banked. It is now Grace’s turn to roll.',
      );
    });

    // Both seats are refreshed, not just the one that acted.
    await waitFor(() => {
      const tokens = api
        .callsTo('GET', GAME_PATH)
        .slice(fetchesBefore)
        .map((call) => call.token);

      expect(new Set(tokens)).toEqual(new Set([TOKEN_A, TOKEN_B]));
    });
  });

  it('starts the next game with New game', async () => {
    const api = installFakeApi();

    let current = (): GameView => gameView({ revision: 9, status: 'COMPLETED', winner: 0 });

    seatedAtBoard(api, () => current());

    api.route('POST', ROUTES.games.newGame(GAME_ID), () => {
      current = () => gameView({ revision: 10, gameNumber: 2, effect: 'NEW_GAME' });

      return ok(current());
    });

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(controls('A').getByRole('button', { name: 'New game' }));

    await waitFor(() => {
      expect(api.callsTo('POST', ROUTES.games.newGame(GAME_ID))).toHaveLength(1);
    });

    expect(api.callsTo('POST', ROUTES.games.newGame(GAME_ID))[0]?.body).toEqual({
      expectedRevision: 9,
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'New game started. It is Ada’s turn to roll.',
      );
    });
    expect(screen.getByRole('region', { name: 'Game 2' })).toBeInTheDocument();
  });

  it('shows a pending state while a roll is in flight', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView());

    const pending = deferred<FakeResponse>();
    api.route('POST', ROUTES.games.roll(GAME_ID), () => pending.promise);

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(controls('A').getByRole('button', { name: 'Roll' }));

    const rolling = await controls('A').findByRole('button', { name: 'Rolling…' });
    expect(rolling).toBeDisabled();

    pending.resolve(ok(gameView({ revision: 2, lastDice: [3, 4], roundScore: 7 })));

    expect(await controls('A').findByRole('button', { name: 'Roll' })).toBeInTheDocument();
  });
});

describe('the double-six moment', () => {
  it('announces the lost round and whose turn is next, and pauses both seats’ controls', async () => {
    const api = installFakeApi();

    // Before the roll: Ada is active and may roll.
    let current: (token: string | null) => GameView = (token) =>
      gameView({
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions: token === TOKEN_A ? ACTIVE_ACTIONS : NO_ACTIONS,
      });

    seatedAtBoard(api, (token) => current(token));

    // The server's answer to the roll: it has already wiped the round score and
    // passed the turn. The client is told, it does not work it out.
    const bust = (token: string | null): GameView =>
      gameView({
        activePlayer: 1,
        roundScore: 0,
        lastDice: [6, 6],
        effect: 'DOUBLE_SIX',
        revision: 2,
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions: token === TOKEN_A ? NO_ACTIONS : ACTIVE_ACTIONS,
      });

    api.route('POST', ROUTES.games.roll(GAME_ID), () => {
      current = bust;

      return ok(bust(TOKEN_A));
    });

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(controls('A').getByRole('button', { name: 'Roll' }));

    const callout = await screen.findByTestId('double-six-callout');
    expect(callout).toHaveTextContent('the round score was lost');
    expect(callout).toHaveTextContent('Next to roll: Grace');
    expect(screen.getByTestId('round-score')).toHaveTextContent('0');

    // The live region tells a screen-reader user the same thing.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Double six. The round score is lost and the dice pass to Grace.',
    );

    // Seat B is the active player now and the server says it may roll — but the
    // animation pause holds its controls for a moment. That pause is the one
    // client-side gate in the app, and it is a timer, not a rule.
    await waitFor(() => {
      expect(controls('B').getByRole('button', { name: 'Roll' })).toBeDisabled();
    });

    // …and it releases on its own.
    await waitFor(
      () => {
        expect(controls('B').getByRole('button', { name: 'Roll' })).toBeEnabled();
      },
      { timeout: 5000 },
    );
  }, 10_000);
});

describe('the end of a game', () => {
  it('shows the winner the server named', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) =>
      gameView({
        players: [
          { userId: ADA.id, displayName: ADA.displayName, globalScore: 84, winCount: 0 },
          { userId: GRACE.id, displayName: GRACE.displayName, globalScore: 104, winCount: 3 },
        ],
        activePlayer: 1,
        status: 'COMPLETED',
        winner: 1,
        effect: 'GAME_WON',
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions: { canRoll: false, canHold: false, canStartNewGame: true },
      }),
    );

    renderPage();

    expect(await screen.findByTestId('winner-banner')).toHaveTextContent('Grace wins game 1');
    expect(card('Grace, Second chair').getByText('Winner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Grace wins game 1.');
    expect(controls('A').getByRole('button', { name: 'Roll' })).toBeDisabled();
    expect(controls('A').getByRole('button', { name: 'New game' })).toBeEnabled();
  });
});

describe('when a seat’s view is stale', () => {
  it('refetches on a revision conflict instead of showing an error', async () => {
    const api = installFakeApi();

    let revision = 1;
    seatedAtBoard(api, () => gameView({ revision, roundScore: revision === 1 ? 0 : 13 }));

    api.route('POST', ROUTES.games.roll(GAME_ID), () => {
      // The other seat moved the game on between the render and the click.
      revision = 5;

      return fail('GAME_REVISION_CONFLICT');
    });

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    const before = api.callsTo('GET', GAME_PATH).length;

    await user.click(controls('A').getByRole('button', { name: 'Roll' }));

    // The board catches up…
    await waitFor(() => {
      expect(screen.getByTestId('round-score')).toHaveTextContent('13');
    });
    expect(api.callsTo('GET', GAME_PATH).length).toBeGreaterThan(before);

    // …and the player is never told off for it.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does show a failure that is not on the contract’s refetch list', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView());
    api.route('POST', ROUTES.games.roll(GAME_ID), () => fail('INTERNAL_SERVER_ERROR'));

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(controls('A').getByRole('button', { name: 'Roll' }));

    const alert = await controls('A').findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong on the server.');
    expect(alert).toHaveTextContent('INTERNAL_SERVER_ERROR');
  });

  it('reports a seat that is not a participant, without breaking the other seat', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView());
    api.route('GET', GAME_PATH, (request) =>
      request.token === TOKEN_A ? ok(gameView()) : fail('NOT_A_PARTICIPANT'),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(
      await controls('B').findByText('This seat is not one of the two players in this match.'),
    ).toBeInTheDocument();
    expect(controls('A').getByRole('button', { name: 'Roll' })).toBeEnabled();
  });
});
