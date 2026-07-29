import { type SeatId } from './seats';

/**
 * Query keys, in one place.
 *
 * A game is keyed by **id and seat**, not by id alone. Two seats fetch the same
 * game with two different tokens and get two different answers — the same
 * board, but `availableActions` and `viewerSeat` are relative to whoever asked.
 * Sharing one cache entry between them would hand one seat the other's buttons.
 *
 * `gameRoot` is the prefix both seat entries live under, so invalidating it
 * after a successful command updates both panels from one call.
 */
export const queryKeys = {
  gameRoot: (gameId: string) => ['game', gameId] as const,
  game: (gameId: string, seat: SeatId) => ['game', gameId, seat] as const,
  users: (seat: SeatId) => ['users', seat] as const,
};
