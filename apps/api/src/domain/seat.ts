/**
 * Which of the two chairs at the table a player occupies.
 *
 * A seat is an index into the game's `players` tuple, never a user id. Identity
 * is resolved server-side exactly once, on the way in; everything downstream
 * reasons about positions. That is what lets the same aggregate describe a match
 * whose players have since renamed, and what keeps a user id out of every
 * scoring expression.
 */
export type Seat = 0 | 1;

/** The other chair. With exactly two seats this is total and cannot fail. */
export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}
