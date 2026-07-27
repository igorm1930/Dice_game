/**
 * The client's entire knowledge of the backend lives in this file.
 *
 * The shape below mirrors the server's PigGameResponse DTO exactly. Nothing in
 * the UI computes a score, decides a winner, or switches a player — it renders
 * whatever this module returns and sends bare, body-less actions. That is the
 * anti-cheat property: there is no client input a rule could be smuggled into.
 */
export interface PigGameState {
  readonly totalScores: readonly [number, number];
  readonly currentTurnScore: number;
  readonly activePlayer: 0 | 1;
  readonly isPlaying: boolean;
  readonly winner: 0 | 1 | null;
  readonly lastRoll: number | null;
  readonly targetScore: number;
}

interface SuccessEnvelope {
  readonly data: PigGameState;
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

async function call(path: string, init?: RequestInit): Promise<PigGameState> {
  const response = await fetch(path, init);
  const body: unknown = await response.json();

  if (!response.ok) {
    const { error, meta } = body as ErrorEnvelope;
    throw new ApiError(response.status, error.code, error.message, meta.requestId);
  }

  return (body as SuccessEnvelope).data;
}

export const fetchState = (): Promise<PigGameState> => call('/api/v1/pig-game');
export const roll = (): Promise<PigGameState> => call('/api/v1/pig-game/roll', { method: 'POST' });
export const hold = (): Promise<PigGameState> => call('/api/v1/pig-game/hold', { method: 'POST' });

/**
 * The one client input in the whole game: the target for the NEW match.
 * Omitted → the server's default. The server validates; the UI only relays.
 */
export const newGame = (targetScore?: number): Promise<PigGameState> =>
  call(
    '/api/v1/pig-game/new-game',
    targetScore === undefined
      ? { method: 'POST' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetScore }),
        },
  );

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return `${error.message} (${error.code}, request ${error.requestId})`;
  }
  return 'Cannot reach the game server. Is the API running?';
}
