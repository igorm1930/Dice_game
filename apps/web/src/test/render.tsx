import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement } from 'react';

import HomePage from '@/app/page';
import { SeatSessionsProvider } from '@/hooks/seat-sessions';
import { type SeatId } from '@/lib/seats';
import { writeActiveGameId, writeSeatSession } from '@/lib/session-storage';

/**
 * Renders the real page inside the real providers.
 *
 * The tests drive the whole client rather than isolated components, because the
 * property most of them are about — two seats, two tokens, one page — only
 * exists when both panels are mounted together.
 */
export function renderPage(): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <SeatSessionsProvider>
        <HomePage />
      </SeatSessionsProvider>
    </QueryClientProvider>
  );

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
