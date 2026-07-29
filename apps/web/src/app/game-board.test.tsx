import { type GameView, ROUTES, type UserSummary } from '@dice-game/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  deferred,
  fail,
  type FakeApi,
  type FakeResponse,
  installFakeApi,
  noContent,
  ok,
} from '@/test/fake-api';
import {
  ACTIVE_ACTIONS,
  ADA,
  authSession,
  GAME_ID,
  gameView,
  GRACE,
  LINUS,
  NO_ACTIONS,
  TOKEN_A,
  TOKEN_B,
  TOKEN_C,
} from '@/test/fixtures';
import { matchAlreadyChosen, renderPage, seatAlreadySignedIn } from '@/test/render';

/**
 * The board.
 *
 * Every assertion here is about rendering what the server said. The important
 * ones are the divergence tests: they build positions in which the server's
 * answer and "is it my turn" point in *different* directions. A suite where the
 * two always agree cannot tell a client that reads `availableActions` apart from
 * a client that re-derives legality from `viewerSeat === activePlayer`, because
 * both produce the same screen.
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

/**
 * A seat's command button, by accessible name.
 *
 * The name carries the seat because the two panels otherwise render six buttons
 * sharing three names, and a screen-reader rotor lists them as "Roll, Roll,
 * Hold, Hold".
 */
function button(seat: 'A' | 'B', label: string): HTMLElement {
  return controls(seat).getByRole('button', { name: `${label}, Seat ${seat}` });
}

function card(name: string) {
  return within(screen.getByRole('article', { name }));
}

/** The live region's sentence, once it has been published into the mounted region. */
async function expectAnnounced(sentence: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByRole('status')).toHaveTextContent(sentence);
  });
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

    expect(button('A', 'Roll')).toBeDisabled();
    expect(button('A', 'Hold')).toBeDisabled();
    expect(button('B', 'Roll')).toBeEnabled();
    expect(button('B', 'Hold')).toBeEnabled();
  });

  it('disables New game when the server says the seat may not start one', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () =>
      gameView({ availableActions: { canRoll: true, canHold: true, canStartNewGame: false } }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(button('A', 'New game')).toBeDisabled();
  });

  it('sends the revision of the view it is showing', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView({ revision: 11 }));
    api.route('POST', ROUTES.games.roll(GAME_ID), () => ok(gameView({ revision: 12 })));

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(button('A', 'Roll'));

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

    await user.click(button('A', 'Hold'));

    await waitFor(() => {
      expect(api.callsTo('POST', ROUTES.games.hold(GAME_ID))).toHaveLength(1);
    });

    expect(api.callsTo('POST', ROUTES.games.hold(GAME_ID))[0]?.body).toEqual({
      expectedRevision: 4,
    });
    await expectAnnounced('Round score banked. It is now Grace’s turn to roll.');

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

    // The banner is up because `status` is COMPLETED and `winner` is a seat —
    // not because one score is higher than the other. Both players are on 0
    // here, so a client comparing the two would show nothing at all.
    expect(screen.getByTestId('winner-banner')).toHaveTextContent('Ada wins game 1');

    await user.click(button('A', 'New game'));

    await waitFor(() => {
      expect(api.callsTo('POST', ROUTES.games.newGame(GAME_ID))).toHaveLength(1);
    });

    expect(api.callsTo('POST', ROUTES.games.newGame(GAME_ID))[0]?.body).toEqual({
      expectedRevision: 9,
    });
    await expectAnnounced('New game started. It is Ada’s turn to roll.');
    expect(screen.getByRole('region', { name: 'Game 2' })).toBeInTheDocument();
  });

  it('keeps the in-flight button focusable, so a keyboard user is not thrown to the top of the page', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () => gameView());

    const pending = deferred<FakeResponse>();
    api.route('POST', ROUTES.games.roll(GAME_ID), () => pending.promise);

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    await user.click(button('A', 'Roll'));

    // `aria-disabled`, not `disabled`: announced as unavailable, the handler
    // drops the click, and — the point — it can still hold focus. A `disabled`
    // element cannot, so disabling the button the player just pressed sent a
    // keyboard user back to <body> on every single turn.
    const rolling = await controls('A').findByRole('button', { name: 'Rolling…, Seat A' });
    expect(rolling).toHaveAttribute('aria-disabled', 'true');
    expect(rolling).toBeEnabled();
    expect(document.activeElement).toBe(rolling);

    await user.click(rolling);
    expect(api.callsTo('POST', ROUTES.games.roll(GAME_ID))).toHaveLength(1);

    pending.resolve(ok(gameView({ revision: 2, lastDice: [3, 4], roundScore: 7 })));

    expect(await controls('A').findByRole('button', { name: 'Roll, Seat A' })).toBeInTheDocument();
  });
});

/**
 * The divergence tests.
 *
 * Everywhere else in this file the fixtures satisfy `canRoll === canHold ===
 * (viewerSeat === activePlayer)`, which makes a client that reads
 * `availableActions` and a client that re-derives legality from two seat indices
 * indistinguishable. These pull the two apart.
 */
describe('when the server’s answer and whose turn it is disagree', () => {
  it('keeps Roll and Hold off for the seat whose turn it still is, in a finished game', async () => {
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

    await screen.findByRole('region', { name: 'Game 1' });

    // By every local measure Seat B holds the dice — `viewerSeat` and
    // `activePlayer` are both 1 — and both of its controls are still off,
    // because that is what `availableActions` said.
    expect(controls('B').getByText('Your turn.')).toBeInTheDocument();
    expect(button('B', 'Roll')).toBeDisabled();
    expect(button('B', 'Hold')).toBeDisabled();
    expect(button('B', 'New game')).toBeEnabled();
  });

  it('enables Roll and disables Hold for one and the same seat', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) =>
      gameView({
        activePlayer: 1,
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions:
          token === TOKEN_B
            ? { canRoll: true, canHold: false, canStartNewGame: false }
            : NO_ACTIONS,
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    // One seat, one turn, two different answers. No local rule can produce this
    // pair; only reading the two booleans can.
    expect(controls('B').getByText('Your turn.')).toBeInTheDocument();
    expect(button('B', 'Roll')).toBeEnabled();
    expect(button('B', 'Hold')).toBeDisabled();
  });

  it('enables New game in a game that has not finished, because canStartNewGame said so', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, () =>
      gameView({
        status: 'ACTIVE',
        winner: null,
        availableActions: { canRoll: true, canHold: true, canStartNewGame: true },
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(screen.queryByTestId('winner-banner')).not.toBeInTheDocument();
    expect(button('A', 'New game')).toBeEnabled();
  });

  it('renders the spectator branch for a seat the server gave no chair', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, (token) =>
      gameView({
        viewerSeat: token === TOKEN_A ? 0 : null,
        availableActions: token === TOKEN_A ? ACTIVE_ACTIONS : NO_ACTIONS,
      }),
    );

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    expect(
      controls('B').getByText('Watching — this seat is not seated in this match.'),
    ).toBeInTheDocument();
    expect(controls('B').queryByText('Your turn.')).not.toBeInTheDocument();
    expect(controls('B').queryByText(/^Waiting for/)).not.toBeInTheDocument();
    expect(button('B', 'Roll')).toBeDisabled();
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
    await user.click(button('A', 'Roll'));

    const callout = await screen.findByTestId('double-six-callout');
    expect(callout).toHaveTextContent('the round score was lost');
    expect(callout).toHaveTextContent('Next to roll: Grace');
    expect(screen.getByTestId('round-score')).toHaveTextContent('0');

    // The live region tells a screen-reader user the same thing.
    await expectAnnounced('Double six. The round score is lost and the dice pass to Grace.');

    // Seat A's Roll is correctly disabled now — the turn passed — so the button
    // the keyboard user was standing on is no longer a place to stand. Focus
    // moves to that seat's own panel, rather than being left on a dead control
    // or dropped to <body>, which is the top of the document.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Seat A controls' }));
    });

    // Seat B is the active player now and the server says it may roll — but the
    // animation pause holds its controls for a moment. That pause is the one
    // client-side gate in the app, and it is a timer, not a rule.
    await waitFor(() => {
      expect(button('B', 'Roll')).toBeDisabled();
    });

    // …and it releases on its own.
    await waitFor(
      () => {
        expect(button('B', 'Roll')).toBeEnabled();
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
    await expectAnnounced('Grace wins game 1.');
    expect(button('A', 'Roll')).toBeDisabled();
    expect(button('A', 'New game')).toBeEnabled();
  });

  it('names the winner the server sent, not the player with the higher score', async () => {
    const api = installFakeApi();
    // Deliberately adversarial: `winner` is the *first* chair while the second
    // chair holds the larger `globalScore`. A client reading `winner` says Ada;
    // a client comparing the two scores says Grace.
    seatedAtBoard(api, (token) =>
      gameView({
        players: [
          { userId: ADA.id, displayName: ADA.displayName, globalScore: 42, winCount: 1 },
          { userId: GRACE.id, displayName: GRACE.displayName, globalScore: 91, winCount: 0 },
        ],
        activePlayer: 0,
        status: 'COMPLETED',
        winner: 0,
        effect: 'GAME_WON',
        viewerSeat: token === TOKEN_A ? 0 : 1,
        availableActions: { canRoll: false, canHold: false, canStartNewGame: true },
      }),
    );

    renderPage();

    expect(await screen.findByTestId('winner-banner')).toHaveTextContent('Ada wins game 1');
    expect(screen.getByTestId('winner-banner')).not.toHaveTextContent('Grace');
    await expectAnnounced('Ada wins game 1.');

    expect(card('Ada, First chair').getByText('Winner')).toBeInTheDocument();
    expect(card('Grace, Second chair').queryByText('Winner')).not.toBeInTheDocument();

    // Ada is still `activePlayer` — a finished game does not rewind the turn —
    // and her card says Winner without also saying "Their turn". The game is
    // over, so there is no turn to be having.
    expect(card('Ada, First chair').queryByText('Their turn')).not.toBeInTheDocument();
    expect(card('Grace, Second chair').queryByText('Their turn')).not.toBeInTheDocument();
  });
});

/**
 * A seat is a slot on this page, not an identity.
 *
 * Both of these fail against a cache keyed by seat alone, because a seat's
 * entries outlive the token that filled them: `enabled: false` stops the
 * refetching, not the reading.
 */
describe('when a seat changes hands', () => {
  function boardWhereSeatAMayRoll(token: string | null): GameView {
    return gameView({
      viewerSeat: token === TOKEN_A ? 0 : 1,
      availableActions: token === TOKEN_A ? ACTIVE_ACTIONS : NO_ACTIONS,
    });
  }

  it('takes the departing player’s board away with them when they sign out', async () => {
    const api = installFakeApi();
    seatedAtBoard(api, boardWhereSeatAMayRoll);
    api.route('POST', ROUTES.auth.logout, () => noContent());

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    expect(button('A', 'Roll')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Sign out, Seat A' }));

    expect(
      await controls('A').findByText(
        'This seat is signed out. Sign in above to take these controls.',
      ),
    ).toBeInTheDocument();

    // Not "disabled" — gone. A signed-out seat has no view to render buttons
    // from, however recently it had one.
    expect(controls('A').queryByRole('button', { name: 'Roll, Seat A' })).not.toBeInTheDocument();
    expect(controls('A').queryByRole('button', { name: 'Hold, Seat A' })).not.toBeInTheDocument();

    // Seat B is untouched.
    expect(button('B', 'Roll')).toBeInTheDocument();
  });

  it('never shows a new occupant the previous one’s buttons', async () => {
    const api = installFakeApi();

    const byToken: Readonly<Record<string, UserSummary>> = {
      [TOKEN_A]: ADA,
      [TOKEN_B]: GRACE,
      [TOKEN_C]: LINUS,
    };

    api.route('GET', ROUTES.auth.me, (request) => {
      const user = request.token === null ? undefined : byToken[request.token];

      return user === undefined
        ? fail('UNAUTHENTICATED')
        : ok({ ...user, email: `${user.displayName.toLowerCase()}@example.com` });
    });

    // Linus's board is held open, so the window between "signed in at Seat A"
    // and "his own answer arrived" is the whole test.
    const linusBoard = deferred<FakeResponse>();

    api.route('GET', GAME_PATH, (request) =>
      request.token === TOKEN_C ? linusBoard.promise : ok(boardWhereSeatAMayRoll(request.token)),
    );

    api.route('POST', ROUTES.auth.logout, () => noContent());
    api.route('POST', ROUTES.auth.login, () => ok(authSession(LINUS, TOKEN_C)));

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    seatAlreadySignedIn('B', GRACE, TOKEN_B);
    matchAlreadyChosen(GAME_ID);

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });
    expect(button('A', 'Roll')).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Sign out, Seat A' }));

    const panel = within(await screen.findByRole('region', { name: 'Seat A' }));
    await user.type(panel.getByLabelText('Email'), 'linus@example.com');
    await user.type(panel.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(panel.getByRole('button', { name: 'Sign in as Seat A' }));

    expect(await panel.findByText('Linus')).toBeInTheDocument();

    // Linus is signed in and his own view has not arrived. What he must not be
    // shown in the meantime is Ada's.
    expect(await controls('A').findByText('Loading this seat’s view…')).toBeInTheDocument();
    expect(controls('A').queryByRole('button', { name: 'Roll, Seat A' })).not.toBeInTheDocument();
    expect(controls('A').queryByText('Your turn.')).not.toBeInTheDocument();

    // And when it does arrive it is his: the server seated him nowhere.
    linusBoard.resolve(ok(gameView({ viewerSeat: null, availableActions: NO_ACTIONS })));

    expect(
      await controls('A').findByText('Watching — this seat is not seated in this match.'),
    ).toBeInTheDocument();
    expect(button('A', 'Roll')).toBeDisabled();
  });
});

describe('when neither seat can load the board', () => {
  it('says so instead of spinning for ever', async () => {
    const api = installFakeApi();

    // The stored game id outlives the tokens, so a plain refresh after the TTL
    // returns to a board with nothing to fetch it with. A query with
    // `enabled: false` is *permanently* `status: 'pending'`, so a spinner gated
    // on `isPending` would never stop.
    api.route('GET', ROUTES.auth.me, () => fail('UNAUTHENTICATED'));
    matchAlreadyChosen(GAME_ID);

    renderPage();

    expect(
      await screen.findByText(/Both seats are signed out, so there is no token/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Loading the board…')).not.toBeInTheDocument();
    expect(api.callsTo('GET', GAME_PATH)).toHaveLength(0);
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

    await user.click(button('A', 'Roll'));

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
    await user.click(button('A', 'Roll'));

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
    expect(button('A', 'Roll')).toBeEnabled();
  });
});
