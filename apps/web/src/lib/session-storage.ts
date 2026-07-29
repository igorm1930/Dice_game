import { displayNameSchema, idSchema } from '@dice-game/contracts';
import { z } from 'zod';

import { type SeatId } from './seats';

/**
 * Where a seat's access token lives, and why it lives there.
 *
 * **The trade-off, stated plainly.** An `httpOnly` cookie is the safer place to
 * put a token, and it is not available here. The assignment requires two
 * authenticated users on one page; two identities cannot share one cookie
 * session on one origin, because the browser would send the same cookie for
 * both seats and the server would see one caller. So each seat holds its own
 * token in `sessionStorage` and sends it in an `Authorization` header.
 *
 * What that costs: a successful XSS on this origin can read both tokens. What
 * bounds it:
 *
 *  - Tokens are short-lived (`JWT_EXPIRES_IN`, 15 minutes by default), so a
 *    stolen one expires quickly.
 *  - Signing out bumps the user's `tokenVersion` server-side, which revokes
 *    every token already issued — revocation is real, not cosmetic.
 *  - `sessionStorage`, not `localStorage`: the scope is one tab, and closing it
 *    ends the session.
 *  - Only the token and `{ id, displayName }` are stored. No password ever
 *    reaches storage, and neither does the email the server returned.
 *
 * The key is versioned. A stored shape that changes is a stored shape that has
 * to be discarded, and bumping `STORAGE_VERSION` does that for every browser at
 * once — rather than leaving old values to be parsed by code that no longer
 * expects them.
 */
const STORAGE_VERSION = 'v1';

const seatKey = (seat: SeatId): string => `dice-game:${STORAGE_VERSION}:seat:${seat}`;

/** The seat's chosen match, so a refresh returns to the board rather than the lobby. */
const ACTIVE_GAME_KEY = `dice-game:${STORAGE_VERSION}:game`;

/**
 * What may be persisted for a seat.
 *
 * Built from the contract's own primitives, so a value written by an older
 * build with a different shape fails the parse and is discarded rather than
 * being rendered.
 */
export const storedSeatSessionSchema = z
  .object({
    accessToken: z.string().min(1),
    user: z.object({ id: idSchema, displayName: displayNameSchema }),
  })
  .strict();

export type StoredSeatSession = z.infer<typeof storedSeatSessionSchema>;

/**
 * `sessionStorage` is unavailable during server rendering and can throw in a
 * browser that has disabled storage for the origin. Every access goes through
 * these two helpers so a refusal degrades to "not signed in" rather than to a
 * blank page.
 */
function readRaw(key: string): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (value === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, value);
    }
  } catch {
    // A browser that refuses storage still gets a working page for this tab;
    // the seat simply will not survive a refresh.
  }
}

/** The stored session for a seat, or `null` if there is none or it is unusable. */
export function readSeatSession(seat: SeatId): StoredSeatSession | null {
  const raw = readRaw(seatKey(seat));

  if (raw === null) {
    return null;
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch {
    clearSeatSession(seat);
    return null;
  }

  const parsed = storedSeatSessionSchema.safeParse(parsedJson);

  if (!parsed.success) {
    clearSeatSession(seat);
    return null;
  }

  return parsed.data;
}

export function writeSeatSession(seat: SeatId, session: StoredSeatSession): void {
  writeRaw(seatKey(seat), JSON.stringify(session));
}

export function clearSeatSession(seat: SeatId): void {
  writeRaw(seatKey(seat), null);
}

export function readActiveGameId(): string | null {
  const raw = readRaw(ACTIVE_GAME_KEY);

  if (raw === null) {
    return null;
  }

  const parsed = idSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

export function writeActiveGameId(gameId: string | null): void {
  writeRaw(ACTIVE_GAME_KEY, gameId);
}
