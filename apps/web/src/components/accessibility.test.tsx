import { type PlayerView, ROUTES, type UserSummary } from '@dice-game/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fail, type FakeApi, installFakeApi, ok } from '@/test/fake-api';
import { ADA, GAME_ID, gameView, GRACE, TOKEN_A, TOKEN_B } from '@/test/fixtures';
import { matchAlreadyChosen, renderPage, seatAlreadySignedIn } from '@/test/render';

/**
 * Accessibility, asserted rather than asserted-to.
 *
 * The specific failure this guards against: a UI whose only visible focus
 * styling is on its text inputs. `grep -rn "focus" src` returning hits on
 * three inputs and no buttons is what the previous generation of this client
 * shipped, so the check here is over *every* focusable control the page
 * renders, buttons included.
 *
 * The rest of the file is about the things a static check cannot see: where
 * focus goes when a branch of the page is replaced, and whether the live region
 * actually announces — which is a question about *when the DOM changes*, not
 * about what it says.
 */

const FOCUS_STYLE = /focus-visible:outline/;

function bothSeatsAtBoard(api: FakeApi): void {
  const byToken: Readonly<Record<string, UserSummary>> = { [TOKEN_A]: ADA, [TOKEN_B]: GRACE };

  api.route('GET', ROUTES.auth.me, (request) => {
    const user = request.token === null ? undefined : byToken[request.token];

    return user === undefined
      ? fail('UNAUTHENTICATED')
      : ok({ ...user, email: `${user.displayName.toLowerCase()}@example.com` });
  });

  api.route('GET', ROUTES.games.byId(GAME_ID), (request) =>
    ok(gameView({ viewerSeat: request.token === TOKEN_A ? 0 : 1 })),
  );

  seatAlreadySignedIn('A', ADA, TOKEN_A);
  seatAlreadySignedIn('B', GRACE, TOKEN_B);
  matchAlreadyChosen(GAME_ID);
}

function liveRegion(): HTMLElement {
  return screen.getByRole('status');
}

/**
 * Every value the live region has held, in order, sampled on each DOM mutation.
 *
 * A live region announces a *change*. Content that arrives with the region is
 * never announced, and re-writing the same string mutates nothing — so the only
 * honest way to test the two is to watch the mutations rather than the final
 * text.
 */
function watchLiveRegion(): { seen: readonly string[]; stop: () => void } {
  const seen: string[] = [];

  const observer = new MutationObserver(() => {
    const live = document.querySelector('p[role="status"][aria-live="polite"]');

    if (live !== null) {
      seen.push(live.textContent);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  return {
    seen,
    stop: () => {
      observer.disconnect();
    },
  };
}

describe('focus styling', () => {
  it('gives every button on the signed-out page a visible focus style', async () => {
    const api = installFakeApi();
    api.route('GET', ROUTES.auth.me, () => fail('UNAUTHENTICATED'));

    renderPage();

    await waitFor(() => {
      expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    });

    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.className).toMatch(FOCUS_STYLE);
    }
  });

  it('gives every button and every field on the board a visible focus style', async () => {
    const api = installFakeApi();
    bothSeatsAtBoard(api);

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.queryAllByRole('textbox'),
      ...screen.queryAllByRole('spinbutton'),
      ...screen.queryAllByRole('combobox'),
    ];

    expect(controls.length).toBeGreaterThan(0);

    for (const control of controls) {
      expect(control.className).toMatch(FOCUS_STYLE);
    }
  });
});

describe('keyboard operability', () => {
  it('completes and submits a sign-in without a mouse', async () => {
    const api = installFakeApi();
    api.route('GET', ROUTES.auth.me, () => fail('UNAUTHENTICATED'));
    api.route('POST', ROUTES.auth.login, () =>
      ok({ accessToken: TOKEN_A, expiresIn: 900, user: { ...ADA, email: 'ada@example.com' } }),
    );
    api.route('GET', ROUTES.users.list, () =>
      ok({ items: [ADA, GRACE], total: 2, limit: 25, offset: 0, hasMore: false }),
    );

    const { user } = renderPage();

    const email = await screen.findByLabelText<HTMLInputElement>('Email', {
      selector: '#seat-a-email',
    });

    // Focus the first field with the keyboard, then walk the form with Tab and
    // submit with Enter — no pointer events at all.
    email.focus();
    await user.keyboard('ada@example.com');
    await user.tab();
    expect(document.activeElement).toHaveAttribute('id', 'seat-a-password');
    await user.keyboard('correct-horse-battery');
    await user.keyboard('{Enter}');

    expect(await screen.findByText('Ada')).toBeInTheDocument();
  });

  it('keeps focus in the seat panel after signing in, instead of dropping it to the top of the page', async () => {
    const api = installFakeApi();
    api.route('GET', ROUTES.auth.me, () => fail('UNAUTHENTICATED'));
    api.route('POST', ROUTES.auth.login, () =>
      ok({ accessToken: TOKEN_A, expiresIn: 900, user: { ...ADA, email: 'ada@example.com' } }),
    );
    api.route('GET', ROUTES.users.list, () =>
      ok({ items: [ADA, GRACE], total: 2, limit: 25, offset: 0, hasMore: false }),
    );

    const { user } = renderPage();

    const panel = within(await screen.findByRole('region', { name: 'Seat A' }));
    await user.type(panel.getByLabelText('Email'), 'ada@example.com');
    await user.type(panel.getByLabelText('Password'), 'correct-horse-battery');
    await user.click(panel.getByRole('button', { name: 'Sign in as Seat A' }));

    await screen.findByText('Ada');

    // The submit button went with the form. Focus must not have gone with it:
    // <body> means the keyboard user is back at the very top of the document.
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
    });
    expect(screen.getByRole('region', { name: 'Seat A' })).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('makes the skip link’s target programmatically focusable', async () => {
    const api = installFakeApi();
    api.route('GET', ROUTES.auth.me, () => fail('UNAUTHENTICATED'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('main')).toBeInTheDocument();
    });

    // Without this, following "Skip to the match" scrolls but leaves focus where
    // it was, so the next Tab starts from the top of the page again.
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'match');
    expect(main).toHaveAttribute('tabindex', '-1');

    main.focus();
    expect(document.activeElement).toBe(main);
  });
});

describe('naming controls that the page renders twice', () => {
  it('gives each seat’s buttons an accessible name of its own', async () => {
    const api = installFakeApi();
    bothSeatsAtBoard(api);

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    // The owning section's `aria-label` is not part of a button's accessible
    // name, so without this a rotor lists "Roll, Roll, Hold, Hold".
    for (const label of ['Roll', 'Hold', 'New game', 'Sign out']) {
      const names = screen
        .getAllByRole('button')
        .map((control) => control.getAttribute('aria-label') ?? control.textContent)
        .filter((name) => name.startsWith(label));

      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
    }
  });
});

describe('announcing what just happened', () => {
  it('puts the effect in a polite, atomic live region', async () => {
    const api = installFakeApi();
    bothSeatsAtBoard(api);

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    const live = liveRegion();
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Waiting for Ada to roll.');
    });
  });

  it('mounts the region empty and writes the first sentence into it afterwards', async () => {
    const api = installFakeApi();

    api.route('GET', ROUTES.auth.me, () => ok({ ...ADA, email: 'ada@example.com' }));
    api.route('GET', ROUTES.users.list, () =>
      ok({ items: [ADA, GRACE], total: 2, limit: 25, offset: 0, hasMore: false }),
    );
    api.route('POST', ROUTES.games.create, () => ok(gameView(), 201));
    api.route('GET', ROUTES.games.byId(GAME_ID), () => ok(gameView()));

    seatAlreadySignedIn('A', ADA, TOKEN_A);

    const { user } = renderPage();

    // Creating a match is the path where this bites: the response *is* the
    // creator's view and is seeded straight into the cache, so the board mounts
    // with its first sentence already available. (Arriving at a board whose
    // fetch is still in flight hides the defect, because the region is empty
    // for a moment anyway.)
    await screen.findByRole('option', { name: 'Grace' });
    await user.selectOptions(screen.getByLabelText('Opponent'), GRACE.id);

    const watcher = watchLiveRegion();
    await user.click(screen.getByRole('button', { name: 'Start match' }));

    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Waiting for Ada to roll.');
    });
    watcher.stop();

    // A screen reader does not announce content that was already inside a live
    // region when the region entered the accessibility tree — that content just
    // came with the furniture. Mounting with the sentence in place therefore
    // loses the first message of every match, so the region has to arrive empty
    // and be written into afterwards.
    expect(watcher.seen[0]).toBe('');
    expect(watcher.seen.at(-1)).toBe('Waiting for Ada to roll.');
  });

  it('announces two identical consecutive sentences, not just the first', async () => {
    const api = installFakeApi();

    // Only `email` is unique, so two players may share a display name — and then
    // two `HELD` sentences in a row are byte-identical.
    const players: [PlayerView, PlayerView] = [
      { userId: ADA.id, displayName: 'Alex', globalScore: 0, winCount: 0 },
      { userId: GRACE.id, displayName: 'Alex', globalScore: 0, winCount: 0 },
    ];

    const HELD_SENTENCE = 'Round score banked. It is now Alex’s turn to roll.';

    let current = gameView({ players, revision: 4 });

    api.route('GET', ROUTES.auth.me, () => ok({ ...ADA, email: 'ada@example.com' }));
    api.route('GET', ROUTES.games.byId(GAME_ID), () => ok(current));
    api.route('POST', ROUTES.games.hold(GAME_ID), () => {
      current = gameView({
        players,
        revision: current.revision + 1,
        effect: 'HELD',
        // The turn alternates; the sentence does not mention which of the two
        // Alexes it is, so it comes out the same both times.
        activePlayer: current.activePlayer === 0 ? 1 : 0,
      });

      return ok(current);
    });

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    matchAlreadyChosen(GAME_ID);

    const { user } = renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    const hold = screen.getByRole('button', { name: 'Hold, Seat A' });
    await user.click(hold);
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(HELD_SENTENCE);
    });

    // Now the same sentence again, from a different revision.
    const watcher = watchLiveRegion();
    await user.click(screen.getByRole('button', { name: 'Hold, Seat A' }));
    await screen.findByText(/revision 6/);

    await waitFor(() => {
      expect(watcher.seen).toContain('');
    });
    watcher.stop();

    // Writing the same string back leaves the DOM untouched and nothing is
    // announced. Clearing first makes the second one a real mutation.
    expect(watcher.seen.at(-1)).toBe(HELD_SENTENCE);
    expect(liveRegion()).toHaveTextContent(HELD_SENTENCE);
  });

  it('describes each die by its face for a screen reader, and says the same thing in words', async () => {
    const api = installFakeApi();
    const byToken: Readonly<Record<string, UserSummary>> = { [TOKEN_A]: ADA, [TOKEN_B]: GRACE };

    api.route('GET', ROUTES.auth.me, (request) => {
      const user = request.token === null ? undefined : byToken[request.token];

      return user === undefined
        ? fail('UNAUTHENTICATED')
        : ok({ ...user, email: `${user.displayName.toLowerCase()}@example.com` });
    });
    api.route('GET', ROUTES.games.byId(GAME_ID), () =>
      ok(gameView({ lastDice: [2, 5], effect: 'NORMAL_ROLL', roundScore: 7 })),
    );

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    matchAlreadyChosen(GAME_ID);

    renderPage();

    expect(await screen.findByLabelText('Die showing 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Die showing 5')).toBeInTheDocument();

    // The dice have labels; the sentence is what a screen-reader user is
    // actually told, and it has to name the same faces, the same roller and the
    // same round score the board is showing.
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent('Ada rolled 2 and 5. Round score 7.');
    });
  });

  it('keeps the trophy out of the announcement', async () => {
    const api = installFakeApi();

    api.route('GET', ROUTES.auth.me, () => ok({ ...ADA, email: 'ada@example.com' }));
    api.route('GET', ROUTES.games.byId(GAME_ID), () =>
      ok(gameView({ status: 'COMPLETED', winner: 0, effect: 'GAME_WON' })),
    );

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    matchAlreadyChosen(GAME_ID);

    renderPage();

    const banner = await screen.findByTestId('winner-banner');
    expect(banner).toHaveTextContent('Ada wins game 1');
    expect(banner.querySelector('[aria-hidden="true"]')).toHaveTextContent('🏆');
  });
});
