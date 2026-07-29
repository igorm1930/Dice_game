'use client';

import { type AuthSession } from '@dice-game/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { fetchMe, logout } from '@/lib/api';
import { belongsToSeat, queryKeys } from '@/lib/query-keys';
import { SEAT_IDS, type SeatId } from '@/lib/seats';
import {
  clearSeatSession,
  readSeatSession,
  type StoredSeatSession,
  writeSeatSession,
} from '@/lib/session-storage';

/**
 * Two seats, two tokens, no shared "current user".
 *
 * The state machine is explicit rather than a pair of nullable fields, because
 * "no session" and "we have not finished checking yet" have to look different on
 * screen: the second must not flash a sign-in form at a player who is still
 * signed in.
 */
export type SeatAuthState =
  | { status: 'restoring' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; session: StoredSeatSession };

interface SeatSessionsValue {
  seats: Readonly<Record<SeatId, SeatAuthState>>;
  /** Records a fresh session from register or login, and persists it for this tab. */
  signIn: (seat: SeatId, session: AuthSession) => void;
  /** Deliberate sign-out. Revokes every token issued to that user, server-side. */
  signOut: (seat: SeatId) => void;
  /**
   * Drops a seat locally without calling the server, for a token the server has
   * already stopped honouring. Calling logout with a dead token would only
   * produce a second 401.
   */
  expireSeat: (seat: SeatId) => void;
}

const SeatSessionsContext = createContext<SeatSessionsValue | null>(null);

const INITIAL_STATE: Readonly<Record<SeatId, SeatAuthState>> = Object.freeze({
  A: { status: 'restoring' },
  B: { status: 'restoring' },
});

export function SeatSessionsProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [seats, setSeats] = useState<Readonly<Record<SeatId, SeatAuthState>>>(INITIAL_STATE);
  const queryClient = useQueryClient();

  /**
   * Restoring a refresh.
   *
   * A page refresh must not sign both players out — that would make the
   * two-seat page unusable in practice. But a token that survived the refresh is
   * only a string: it may have expired, and signing out anywhere bumps the
   * user's `tokenVersion`, which revokes it. So each restored token is offered
   * to `GET /api/auth/me` and kept only if the server still honours it. The
   * client never inspects the token itself.
   *
   * `sessionStorage` is read here rather than during render: it does not exist
   * on the server, and reading it in a `useState` initialiser would produce a
   * hydration mismatch.
   */
  useEffect(() => {
    let cancelled = false;

    const restore = async (): Promise<void> => {
      const restored = await Promise.all(
        SEAT_IDS.map(async (seat): Promise<readonly [SeatId, SeatAuthState]> => {
          const stored = readSeatSession(seat);

          if (stored === null) {
            return [seat, { status: 'signed-out' }] as const;
          }

          try {
            const user = await fetchMe(stored.accessToken);
            const session: StoredSeatSession = {
              accessToken: stored.accessToken,
              user: { id: user.id, displayName: user.displayName },
            };

            // The server is the authority on the display name too: it may have
            // changed since the token was minted.
            writeSeatSession(seat, session);

            return [seat, { status: 'signed-in', session }] as const;
          } catch {
            clearSeatSession(seat);

            return [seat, { status: 'signed-out' }] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      setSeats(Object.fromEntries(restored) as Record<SeatId, SeatAuthState>);
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    (seat: SeatId, session: AuthSession) => {
      // Only the token and the two fields the UI renders. The email the server
      // returned is not stored, and a password never reaches this function.
      const stored: StoredSeatSession = {
        accessToken: session.accessToken,
        user: { id: session.user.id, displayName: session.user.displayName },
      };

      writeSeatSession(seat, stored);
      setSeats((current) => ({ ...current, [seat]: { status: 'signed-in', session: stored } }));

      // Somebody arriving at one seat can be the opponent the *other* seat is
      // looking for, and the opponent list is fetched once with the creating
      // seat's token and keyed on that seat's identity — so nothing about this
      // seat's sign-in would otherwise invalidate it. Create an account at
      // Seat A and then one at Seat B and the picker stays empty, with no way
      // forward but a refresh.
      //
      // Invalidated at the root rather than for one key: the list belongs to
      // whichever seat is creating the match, which is not necessarily this one.
      void queryClient.invalidateQueries({ queryKey: queryKeys.usersRoot() });
    },
    [queryClient],
  );

  /**
   * Drops a seat.
   *
   * The cached queries go with it. `enabled: false` alone would only stop the
   * seat *refetching*: the last answer the departing token produced stays in the
   * cache, and TanStack Query keeps handing it back. That is how a signed-out
   * panel ends up rendering an enabled Roll button, and how the next person to
   * sit here would be shown the previous occupant's `availableActions` until
   * their own fetch resolves.
   */
  const expireSeat = useCallback(
    (seat: SeatId) => {
      clearSeatSession(seat);
      queryClient.removeQueries({ predicate: (query) => belongsToSeat(query.queryKey, seat) });
      setSeats((current) => ({ ...current, [seat]: { status: 'signed-out' } }));
    },
    [queryClient],
  );

  const signOut = useCallback(
    (seat: SeatId) => {
      // The token is read from the closure, not from inside a `setSeats`
      // updater. An updater must be pure — React invokes it twice under
      // StrictMode — and one deliberate sign-out must produce exactly one
      // logout request.
      const seatState = seats[seat];

      if (seatState.status === 'signed-in') {
        // Best effort, and deliberately not awaited: the seat is signed out
        // here whether or not the call lands. If it does land, every token
        // previously issued to that user stops verifying.
        void logout(seatState.session.accessToken).catch(() => undefined);
      }

      expireSeat(seat);
    },
    [seats, expireSeat],
  );

  const value = useMemo<SeatSessionsValue>(
    () => ({ seats, signIn, signOut, expireSeat }),
    [seats, signIn, signOut, expireSeat],
  );

  return <SeatSessionsContext.Provider value={value}>{children}</SeatSessionsContext.Provider>;
}

export function useSeatSessions(): SeatSessionsValue {
  const value = useContext(SeatSessionsContext);

  if (value === null) {
    throw new Error('useSeatSessions must be used inside a SeatSessionsProvider.');
  }

  return value;
}

/** One seat's state. */
export function useSeat(seat: SeatId): SeatAuthState {
  return useSeatSessions().seats[seat];
}

/** One seat's token, or `null` when that seat is not signed in. */
export function useSeatToken(seat: SeatId): string | null {
  const state = useSeat(seat);

  return state.status === 'signed-in' ? state.session.accessToken : null;
}

/**
 * The id of the user currently occupying a seat, or `null` when nobody is.
 *
 * This is what a seat's cache entries are keyed by, so that a seat changing
 * hands changes the key rather than inheriting the previous occupant's answers.
 */
export function useSeatUserId(seat: SeatId): string | null {
  const state = useSeat(seat);

  return state.status === 'signed-in' ? state.session.user.id : null;
}
