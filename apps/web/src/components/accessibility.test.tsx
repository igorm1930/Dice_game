import { ROUTES, type UserSummary } from '@dice-game/contracts';
import { screen, waitFor } from '@testing-library/react';
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
});

describe('announcing what just happened', () => {
  it('puts the effect in a polite, atomic live region', async () => {
    const api = installFakeApi();
    bothSeatsAtBoard(api);

    renderPage();

    await screen.findByRole('region', { name: 'Game 1' });

    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveAttribute('aria-atomic', 'true');
    expect(live).toHaveTextContent('Waiting for Ada to roll.');
  });

  it('describes each die by its face for a screen reader', async () => {
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
  });
});
