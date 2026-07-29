import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, StrictMode } from 'react';

import HomePage from '@/app/page';
import { SeatSessionsProvider } from '@/hooks/seat-sessions';
import { type SeatId } from '@/lib/seats';
import { writeActiveGameId, writeSeatSession } from '@/lib/session-storage';

export interface RenderPageOptions {
  /**
   * Wraps the page in `<StrictMode>`, which double-invokes render functions,
   * effects and — the reason this option exists — the updater functions passed
   * to `setState`. An impure updater that fires a request is invisible without
   * it and doubles every request with it.
   */
  strict?: boolean;
}

/**
 * Renders the real page inside the real providers.
 *
 * The tests drive the whole client rather than isolated components, because the
 * property most of them are about — two seats, two tokens, one page — only
 * exists when both panels are mounted together.
 */
export function renderPage(
  options: RenderPageOptions = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const page: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <SeatSessionsProvider>
        <HomePage />
      </SeatSessionsProvider>
    </QueryClientProvider>
  );

  const ui = options.strict === true ? <StrictMode>{page}</StrictMode> : page;

  return { ...render(ui), user: userEvent.setup() };
}

/**
 * Puts a token in `sessionStorage` for one seat, as a previous page load would
 * have left it. The provider still revalidates it against `GET /api/auth/me`,
 * so a test using this must serve that route.
 */
export function seatAlreadySignedIn(
  seat: SeatId,
  user: { id: string; displayName: string },
  accessToken: string,
): void {
  writeSeatSession(seat, { accessToken, user: { id: user.id, displayName: user.displayName } });
}

/** Starts the page on the board rather than on the creation form. */
export function matchAlreadyChosen(gameId: string): void {
  writeActiveGameId(gameId);
}
