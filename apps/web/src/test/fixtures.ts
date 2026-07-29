import {
  type AuthSession,
  type AvailableActions,
  DEFAULT_WINNING_SCORE,
  type GameView,
  STANDARD_RULESET,
  type UserSummary,
} from '@dice-game/contracts';

/**
 * Fixtures for the component suite.
 *
 * Ids are 24-character hex because `idSchema` says so, and every view built
 * here is parsed by the real `gameViewSchema` on its way through the API client
 * — a fixture that drifted from the contract would fail the parse rather than
 * quietly test a shape the server never sends.
 *
 * Note what the helpers do *not* have: no `roll()` that computes a new score,
 * no notion of a bust. A test that wants a double six states the whole
 * resulting view, because that is what the server would send.
 */
export const GAME_ID = '0123456789abcdef01234567';

export const ADA: UserSummary = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', displayName: 'Ada' };
export const GRACE: UserSummary = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', displayName: 'Grace' };
export const LINUS: UserSummary = { id: 'cccccccccccccccccccccccc', displayName: 'Linus' };

export const TOKEN_A = 'token-for-seat-a';
export const TOKEN_B = 'token-for-seat-b';
/** A third token, for the case where a seat changes hands mid-session. */
export const TOKEN_C = 'token-for-a-second-occupant';

export const NO_ACTIONS: AvailableActions = {
  canRoll: false,
  canHold: false,
  canStartNewGame: false,
};
export const ACTIVE_ACTIONS: AvailableActions = {
  canRoll: true,
  canHold: true,
  canStartNewGame: true,
};

export function authSession(user: UserSummary, accessToken: string): AuthSession {
  return {
    accessToken,
    expiresIn: 900,
    user: {
      id: user.id,
      email: `${user.displayName.toLowerCase()}@example.com`,
      displayName: user.displayName,
    },
  };
}

export function gameView(overrides: Partial<GameView> = {}): GameView {
  return {
    id: GAME_ID,
    players: [
      { userId: ADA.id, displayName: ADA.displayName, globalScore: 0, winCount: 0 },
      { userId: GRACE.id, displayName: GRACE.displayName, globalScore: 0, winCount: 0 },
    ],
    activePlayer: 0,
    roundScore: 0,
    lastDice: null,
    winningScore: DEFAULT_WINNING_SCORE,
    ruleset: STANDARD_RULESET,
    gameNumber: 1,
    status: 'ACTIVE',
    winner: null,
    revision: 1,
    availableActions: ACTIVE_ACTIONS,
    effect: null,
    viewerSeat: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
