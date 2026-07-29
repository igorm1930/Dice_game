/**
 * The two seats *at this browser*.
 *
 * Deliberately distinct from the contract's `Seat`, which is `0 | 1` — an index
 * into a game's `players` tuple, assigned by the server. This type is a local
 * UI concept: which of the two sign-in panels on the page a request belongs to.
 * Each carries its own access token and its own view of the game, because the
 * assignment asks for two authenticated users on one page.
 *
 * The mapping between the two runs one way only, and it comes from the server:
 * a seat panel learns which chair it occupies from `viewerSeat` on the game view
 * it fetched with its own token. Nothing here infers it.
 */
export const SEAT_IDS = ['A', 'B'] as const;

export type SeatId = (typeof SEAT_IDS)[number];

export const SEAT_LABELS: Readonly<Record<SeatId, string>> = Object.freeze({
  A: 'Seat A',
  B: 'Seat B',
});

/** The other panel on the page. Used only to suggest a default opponent. */
export const OTHER_SEAT: Readonly<Record<SeatId, SeatId>> = Object.freeze({
  A: 'B',
  B: 'A',
});
