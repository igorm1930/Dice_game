import type { Session } from './api';

/**
 * The two seats' credentials, persisted so a page refresh does not log both
 * players out mid-match (Extra #2, the local-storage half of it).
 *
 * Only the token and the player projection are stored — never a password.
 * Tokens are opaque and server-revocable, and a stored one that the server no
 * longer honours is discarded on start-up rather than trusted.
 */
export type SeatSessions = readonly [Session | null, Session | null];

const STORAGE_KEY = 'pig-game.sessions.v1';

export const EMPTY_SESSIONS: SeatSessions = [null, null];

export function loadSessions(): SeatSessions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return EMPTY_SESSIONS;
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      return EMPTY_SESSIONS;
    }

    return [asSession(parsed[0]), asSession(parsed[1])];
  } catch {
    // A corrupt or unavailable store must never break the page — worst case
    // both players sign in again.
    return EMPTY_SESSIONS;
  }
}

export function saveSessions(sessions: SeatSessions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Private-browsing quota errors are not worth failing a game over.
  }
}

function asSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const candidate = value as Partial<Session>;
  const player = candidate.player;

  if (
    typeof candidate.token !== 'string' ||
    typeof player !== 'object' ||
    player === null ||
    typeof player.id !== 'string' ||
    typeof player.username !== 'string' ||
    typeof player.wins !== 'number'
  ) {
    return null;
  }

  return { token: candidate.token, player: { ...player } };
}
