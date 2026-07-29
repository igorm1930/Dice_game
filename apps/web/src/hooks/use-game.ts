'use client';

import { type GameView } from '@dice-game/contracts';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { fetchGame, hold, listUsers, newGame, rollDice, type UserList } from '@/lib/api';
import { isRefetchable } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { type SeatId } from '@/lib/seats';

import { useSeatToken, useSeatUserId } from './seat-sessions';

/**
 * The identity a seat's cache entry belongs to when nobody is sitting in it.
 *
 * A signed-out seat runs no query — `enabled` is false — but it still needs a
 * key, and that key must not be one a real user could ever hold. Reusing the
 * previous occupant's key is precisely the bug this constant exists to make
 * impossible.
 */
const NOBODY = 'signed-out';

/**
 * The game, as one seat sees it.
 *
 * Keyed by game id, seat *and* the user in that seat, because the answer differs
 * per caller: `availableActions` and `viewerSeat` are relative to the token that
 * asked. Two seats therefore hold two cache entries for one game, and both are
 * refreshed together after any command.
 *
 * There is no polling and no interval. Live synchronisation between separate
 * browsers is explicitly out of scope; within this page, an action by either
 * seat invalidates both entries, which is what keeps the two panels in step.
 */
export function useGameQuery(gameId: string, seat: SeatId): UseQueryResult<GameView> {
  const token = useSeatToken(seat);
  const userId = useSeatUserId(seat);

  return useQuery({
    queryKey: queryKeys.game(gameId, seat, userId ?? NOBODY),
    queryFn: ({ signal }) => {
      if (token === null) {
        throw new Error('The game query ran for a seat with no token.');
      }

      return fetchGame(gameId, token, signal);
    },
    enabled: token !== null,
  });
}

/** The opponent picker's list, fetched with the creating seat's own token. */
export function useUsersQuery(seat: SeatId): UseQueryResult<UserList> {
  const token = useSeatToken(seat);
  const userId = useSeatUserId(seat);

  return useQuery({
    queryKey: queryKeys.users(seat, userId ?? NOBODY),
    queryFn: ({ signal }) => {
      if (token === null) {
        throw new Error('The user list query ran for a seat with no token.');
      }

      return listUsers(token, signal);
    },
    enabled: token !== null,
  });
}

export type GameCommandName = 'roll' | 'hold' | 'newGame';

/**
 * The three write commands, behind one hook.
 *
 * Each sends `expectedRevision` — the revision of the view the seat is actually
 * looking at, passed in by the component at the moment of the click. That is
 * the whole concurrency story: the server updates on `{ _id, revision }`, so a
 * double-clicked Roll produces one roll, and a seat acting on a board the other
 * seat has already moved is refused rather than replayed.
 */
const SEND: Readonly<
  Record<
    GameCommandName,
    (gameId: string, token: string, expectedRevision: number) => Promise<GameView>
  >
> = Object.freeze({
  roll: (gameId, token, expectedRevision) => rollDice(gameId, token, { expectedRevision }),
  hold: (gameId, token, expectedRevision) => hold(gameId, token, { expectedRevision }),
  // The winning score is omitted deliberately: leaving it out keeps the score
  // the current match was created with, and this UI offers no way to change it
  // mid-series.
  newGame: (gameId, token, expectedRevision) => newGame(gameId, token, { expectedRevision }),
});

export interface GameCommand {
  run: (expectedRevision: number) => void;
  isPending: boolean;
  /**
   * The failure worth showing a player — `null` for anything the contract says
   * to answer by refetching.
   */
  error: Error | null;
}

export function useGameCommand(
  command: GameCommandName,
  gameId: string,
  seat: SeatId,
): GameCommand {
  const token = useSeatToken(seat);
  const userId = useSeatUserId(seat);
  const queryClient = useQueryClient();

  const mutation = useMutation<GameView, Error, number>({
    mutationFn: (expectedRevision) => {
      if (token === null) {
        throw new Error('A game command ran for a seat with no token.');
      }

      return SEND[command](gameId, token, expectedRevision);
    },

    onSuccess: (view) => {
      // The response *is* the acting seat's new view, so it is written straight
      // into that seat's entry — the animation reacts to this without waiting
      // for a round trip. The other seat's entry is stale by definition, so both
      // are then invalidated and refetched.
      if (userId !== null) {
        queryClient.setQueryData(queryKeys.game(gameId, seat, userId), view);
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.gameRoot(gameId) });
    },

    onError: (error) => {
      // A revision conflict is not a failure to report. It means this seat was
      // looking at an older board than the one the server holds, which is the
      // normal consequence of two seats sharing a page. The same is true of
      // acting after the turn passed or after the game was won. The answer to
      // all three is a fresh view, and the contract's REFETCH_ON names them.
      if (isRefetchable(error)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.gameRoot(gameId) });
      }
    },
  });

  return {
    run: (expectedRevision: number) => {
      mutation.mutate(expectedRevision);
    },
    isPending: mutation.isPending,
    error: mutation.error !== null && !isRefetchable(mutation.error) ? mutation.error : null,
  };
}
