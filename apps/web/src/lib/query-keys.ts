import { type SeatId } from './seats';

/**
 * Query keys, in one place.
 *
 * A game is keyed by **id, seat and the id of the user sitting in that seat** —
 * not by id alone, and not by id and seat alone.
 *
 * Two seats fetch the same game with two different tokens and get two different
 * answers: the same board, but `availableActions` and `viewerSeat` are relative
 * to whoever asked. Sharing one cache entry between them would hand one seat the
 * other's buttons.
 *
 * The user id is the second half of the same argument, and it is the one that
 * was missing. A seat is a slot on this page, not an identity: sign out of
 * Seat A and sign somebody else in, and a key of `['game', id, 'A']` serves the
 * new arrival the previous occupant's `availableActions` until their own fetch
 * lands. Keying on the identity that filled the cache makes that impossible
 * rather than brief.
 *
 * `gameRoot` is the prefix every seat entry lives under, so invalidating it
 * after a successful command updates both panels from one call.
 */
export const queryKeys = {
  gameRoot: (gameId: string) => ['game', gameId] as const,
  game: (gameId: string, seat: SeatId, userId: string) => ['game', gameId, seat, userId] as const,
  users: (seat: SeatId, userId: string) => ['users', seat, userId] as const,
};

/**
 * Whether a cached query belongs to one browser seat.
 *
 * Used to drop a seat's entries the moment it signs out or its token expires.
 * Without this, `enabled: false` only stops the seat *refetching* — the last
 * answer the departing user's token produced stays in the cache and carries on
 * being rendered.
 */
export function belongsToSeat(queryKey: readonly unknown[], seat: SeatId): boolean {
  const [root] = queryKey;

  if (root === 'game') {
    return queryKey[2] === seat;
  }

  if (root === 'users') {
    return queryKey[1] === seat;
  }

  return false;
}
