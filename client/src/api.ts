/**
 * The client's entire knowledge of the backend lives in this file.
 *
 * The shapes below mirror the server's DTOs exactly. Nothing in the UI computes
 * a score, decides a winner, switches a player, or decides whose turn it is —
 * it renders whatever this module returns and sends bare, body-less actions
 * authenticated by a bearer token the server issued. That is the anti-cheat
 * property: there is no client input a rule could be smuggled into, and no way
 * to act as a player whose credential you do not hold.
 */
export interface Player {
  readonly id: string;
  readonly username: string;
  readonly wins: number;
}

export interface Session {
  readonly player: Player;
  readonly token: string;
}

export interface PigGameState {
  readonly players: readonly [Player, Player];
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: 0 | 1;
  readonly isPlaying: boolean;
  readonly winner: 0 | 1 | null;
  readonly lastRoll: readonly [number, number] | null;
  readonly bustedOnLastRoll: boolean;
  readonly targetScore: number;
  readonly viewerSeat: 0 | 1 | null;
}

interface SuccessEnvelope<T> {
  readonly data: T;
  readonly meta: { readonly requestId: string; readonly timestamp: string };
}

interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string };
  readonly meta: { readonly requestId: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;

  const response = await fetch(path, {
    ...rest,
    headers: {
      ...headers,
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const body: unknown = await response.json();

  if (!response.ok) {
    const { error, meta } = body as ErrorEnvelope;
    throw new ApiError(response.status, error.code, error.message, meta.requestId);
  }

  return (body as SuccessEnvelope<T>).data;
}

function jsonPost(body: unknown, token?: string): RequestInit & { token?: string } {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...(token === undefined ? {} : { token }),
  };
}

// --- Authentication --------------------------------------------------------

export const register = (username: string, password: string): Promise<Session> =>
  call<Session>('/api/v1/auth/register', jsonPost({ username, password }));

export const login = (username: string, password: string): Promise<Session> =>
  call<Session>('/api/v1/auth/login', jsonPost({ username, password }));

export const logout = (token: string): Promise<void> =>
  call<void>('/api/v1/auth/logout', { method: 'POST', token });

/** Used on start-up to check whether a token restored from storage is still good. */
export const me = (token: string): Promise<Player> => call<Player>('/api/v1/auth/me', { token });

// --- Game ------------------------------------------------------------------

export const fetchState = (token: string): Promise<PigGameState> =>
  call<PigGameState>('/api/v1/pig-game', { token });

export const roll = (token: string): Promise<PigGameState> =>
  call<PigGameState>('/api/v1/pig-game/roll', { method: 'POST', token });

export const hold = (token: string): Promise<PigGameState> =>
  call<PigGameState>('/api/v1/pig-game/hold', { method: 'POST', token });

/**
 * The only client input in the whole game: who the opponent is, and what the
 * winning score should be. Omitting the score takes the server's default.
 */
export const newGame = (
  token: string,
  opponent: string,
  targetScore?: number,
): Promise<PigGameState> =>
  call<PigGameState>(
    '/api/v1/pig-game/new-game',
    jsonPost(targetScore === undefined ? { opponent } : { opponent, targetScore }, token),
  );

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.code}, request ${error.requestId})`;
  }
  return 'Cannot reach the game server. Is the API running?';
}
