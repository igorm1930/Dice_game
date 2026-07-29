/**
 * The route table, as data.
 *
 * Shared so the client never hand-writes a path and a contract test can assert
 * the API mounts exactly these and nothing else. The previous generation had
 * five endpoints that no client called and no reviewer expected; a route table
 * in the contract makes that impossible to do accidentally.
 */
export const API_PREFIX = '/api';

export const ROUTES = {
  auth: {
    register: `${API_PREFIX}/auth/register`,
    login: `${API_PREFIX}/auth/login`,
    logout: `${API_PREFIX}/auth/logout`,
    me: `${API_PREFIX}/auth/me`,
  },
  users: {
    list: `${API_PREFIX}/users`,
  },
  games: {
    create: `${API_PREFIX}/games`,
    byId: (gameId: string) => `${API_PREFIX}/games/${gameId}`,
    roll: (gameId: string) => `${API_PREFIX}/games/${gameId}/roll`,
    hold: (gameId: string) => `${API_PREFIX}/games/${gameId}/hold`,
    newGame: (gameId: string) => `${API_PREFIX}/games/${gameId}/new-game`,
  },
  health: {
    live: `${API_PREFIX}/health/live`,
    ready: `${API_PREFIX}/health/ready`,
  },
} as const;

/**
 * Endpoints reachable without a token. Everything else is guarded by default —
 * the API mounts a global guard and these opt out explicitly, so a controller
 * whose decorator was forgotten fails closed rather than open.
 */
export const PUBLIC_ROUTES: readonly string[] = Object.freeze([
  ROUTES.auth.register,
  ROUTES.auth.login,
  ROUTES.health.live,
  ROUTES.health.ready,
]);
