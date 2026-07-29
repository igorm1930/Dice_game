import { ROUTES, type UserSummary } from '@dice-game/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { fail, type FakeApi, installFakeApi, ok } from '@/test/fake-api';
import { ADA, authSession, GRACE, TOKEN_A, TOKEN_B } from '@/test/fixtures';
import { renderPage, seatAlreadySignedIn } from '@/test/render';

/**
 * Two seats, two tokens.
 *
 * The property under test is that the panels share nothing: signing in at one
 * leaves the other exactly as it was, each request carries its own seat's token,
 * and a refresh restores both — or neither, if the server no longer honours
 * them.
 */

const PASSWORD = 'correct-horse-battery';

function emailFor(user: UserSummary): string {
  return `${user.displayName.toLowerCase()}@example.com`;
}

function serveMe(api: FakeApi, byToken: Readonly<Record<string, UserSummary>>): void {
  api.route('GET', ROUTES.auth.me, (request) => {
    const user = request.token === null ? undefined : byToken[request.token];

    return user === undefined ? fail('UNAUTHENTICATED') : ok({ ...user, email: emailFor(user) });
  });
}

function serveUsers(api: FakeApi): void {
  api.route('GET', ROUTES.users.list, () =>
    ok({ items: [ADA, GRACE], total: 2, limit: 25, offset: 0, hasMore: false }),
  );
}

function serveLogin(api: FakeApi): void {
  api.route('POST', ROUTES.auth.login, (request) => {
    const body = request.body as { email?: string } | undefined;

    if (body?.email === emailFor(ADA)) {
      return ok(authSession(ADA, TOKEN_A));
    }

    if (body?.email === emailFor(GRACE)) {
      return ok(authSession(GRACE, TOKEN_B));
    }

    return fail('INVALID_CREDENTIALS');
  });
}

function seatPanel(seat: 'A' | 'B') {
  return within(screen.getByRole('region', { name: `Seat ${seat}` }));
}

async function signIn(
  user: ReturnType<typeof renderPage>['user'],
  seat: 'A' | 'B',
  as: UserSummary,
): Promise<void> {
  const panel = seatPanel(seat);

  await user.type(panel.getByLabelText('Email'), emailFor(as));
  await user.type(panel.getByLabelText('Password'), PASSWORD);
  await user.click(panel.getByRole('button', { name: `Sign in as Seat ${seat}` }));
}

describe('signing in at each seat', () => {
  it('signs one seat in without touching the other', async () => {
    const api = installFakeApi();
    serveLogin(api);
    serveMe(api, { [TOKEN_A]: ADA, [TOKEN_B]: GRACE });
    serveUsers(api);

    const { user } = renderPage();
    await waitFor(() => {
      expect(seatPanel('A').getByRole('button', { name: 'Sign in as Seat A' })).toBeInTheDocument();
    });

    await signIn(user, 'A', ADA);

    expect(await seatPanel('A').findByText('Ada')).toBeInTheDocument();
    // Seat B is untouched: still a form, still no identity.
    expect(seatPanel('B').getByRole('button', { name: 'Sign in as Seat B' })).toBeInTheDocument();
    expect(seatPanel('B').queryByText('Grace')).not.toBeInTheDocument();

    await signIn(user, 'B', GRACE);

    expect(await seatPanel('B').findByText('Grace')).toBeInTheDocument();
    expect(seatPanel('A').getByText('Ada')).toBeInTheDocument();
  });

  it('keeps a separate token per seat, and stores no password', async () => {
    const api = installFakeApi();
    serveLogin(api);
    serveMe(api, { [TOKEN_A]: ADA, [TOKEN_B]: GRACE });
    serveUsers(api);

    const { user } = renderPage();
    await waitFor(() => {
      expect(seatPanel('A').getByRole('button', { name: 'Sign in as Seat A' })).toBeInTheDocument();
    });

    await signIn(user, 'A', ADA);
    await seatPanel('A').findByText('Ada');
    await signIn(user, 'B', GRACE);
    await seatPanel('B').findByText('Grace');

    const storedA = window.sessionStorage.getItem('dice-game:v1:seat:A') ?? '';
    const storedB = window.sessionStorage.getItem('dice-game:v1:seat:B') ?? '';

    expect(JSON.parse(storedA)).toEqual({
      accessToken: TOKEN_A,
      user: { id: ADA.id, displayName: ADA.displayName },
    });
    expect(JSON.parse(storedB)).toEqual({
      accessToken: TOKEN_B,
      user: { id: GRACE.id, displayName: GRACE.displayName },
    });
    expect(storedA).not.toContain(PASSWORD);
    expect(storedB).not.toContain(PASSWORD);

    // The user list is Seat A's request, so it carries Seat A's token — never
    // "the" token.
    expect(api.callsTo('GET', ROUTES.users.list).every((call) => call.token === TOKEN_A)).toBe(
      true,
    );
  });

  it('shows the server’s failure without guessing at its cause', async () => {
    const api = installFakeApi();
    serveLogin(api);
    serveMe(api, {});

    const { user } = renderPage();
    await waitFor(() => {
      expect(seatPanel('A').getByRole('button', { name: 'Sign in as Seat A' })).toBeInTheDocument();
    });

    const panel = seatPanel('A');
    await user.type(panel.getByLabelText('Email'), 'nobody@example.com');
    await user.type(panel.getByLabelText('Password'), PASSWORD);
    await user.click(panel.getByRole('button', { name: 'Sign in as Seat A' }));

    const alert = await panel.findByRole('alert');
    expect(alert).toHaveTextContent('That email and password combination was not recognised.');
    expect(alert).toHaveTextContent('INVALID_CREDENTIALS');
  });

  it('validates the field with the contract’s own schema before sending anything', async () => {
    const api = installFakeApi();
    serveLogin(api);
    serveMe(api, {});

    const { user } = renderPage();
    await waitFor(() => {
      expect(seatPanel('A').getByRole('button', { name: 'Sign in as Seat A' })).toBeInTheDocument();
    });

    const panel = seatPanel('A');
    await user.type(panel.getByLabelText('Email'), 'not-an-email');
    await user.type(panel.getByLabelText('Password'), 'short');
    await user.click(panel.getByRole('button', { name: 'Sign in as Seat A' }));

    expect(await panel.findByText(/invalid email/i)).toBeInTheDocument();
    expect(api.callsTo('POST', ROUTES.auth.login)).toHaveLength(0);
  });
});

describe('coming back to a refreshed page', () => {
  it('restores both seats and revalidates each token against the server', async () => {
    const api = installFakeApi();
    serveMe(api, { [TOKEN_A]: ADA, [TOKEN_B]: GRACE });
    serveUsers(api);

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    seatAlreadySignedIn('B', GRACE, TOKEN_B);

    renderPage();

    expect(await seatPanel('A').findByText('Ada')).toBeInTheDocument();
    expect(await seatPanel('B').findByText('Grace')).toBeInTheDocument();

    const revalidations = api.callsTo('GET', ROUTES.auth.me);
    expect(revalidations.map((call) => call.token).sort()).toEqual([TOKEN_A, TOKEN_B].sort());
  });

  it('discards a restored token the server no longer honours, and keeps the other', async () => {
    const api = installFakeApi();
    // Seat B's token has been revoked — someone signed that user out elsewhere,
    // which bumps their tokenVersion.
    serveMe(api, { [TOKEN_A]: ADA });
    serveUsers(api);

    seatAlreadySignedIn('A', ADA, TOKEN_A);
    seatAlreadySignedIn('B', GRACE, TOKEN_B);

    renderPage();

    expect(await seatPanel('A').findByText('Ada')).toBeInTheDocument();
    expect(
      await seatPanel('B').findByRole('button', { name: 'Sign in as Seat B' }),
    ).toBeInTheDocument();
    expect(window.sessionStorage.getItem('dice-game:v1:seat:B')).toBeNull();
    expect(window.sessionStorage.getItem('dice-game:v1:seat:A')).not.toBeNull();
  });
});
