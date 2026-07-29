'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';

import { SeatSessionsProvider } from '@/hooks/seat-sessions';

/**
 * One `QueryClient` for the page, created once per mount rather than at module
 * scope — a module-level client would be shared between requests during server
 * rendering, which is how one user's data ends up in another user's response.
 *
 * `retry: false` because an `ApiError` is a decision, not a hiccup: the server
 * said 403, or 409, or 422, and asking again produces the same answer more
 * slowly. The one class of failure worth re-issuing — a stale revision — is
 * handled explicitly by refetching, in `use-game.ts`.
 *
 * No `refetchInterval` anywhere. Polling was ruled out; the two panels on this
 * page stay in step because every successful command invalidates both.
 */
export function Providers({ children }: { children: ReactNode }): React.JSX.Element {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <SeatSessionsProvider>{children}</SeatSessionsProvider>
    </QueryClientProvider>
  );
}
