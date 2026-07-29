import {
  type AuthenticatedUser,
  authenticatedUserSchema,
  type AuthSession,
  authSessionSchema,
  type CreateGameRequest,
  type GameView,
  gameViewSchema,
  type HoldRequest,
  type LoginRequest,
  type NewGameRequest,
  paginated,
  type RegisterRequest,
  type RollRequest,
  ROUTES,
  userSummarySchema,
} from '@dice-game/contracts';
import { type z } from 'zod';

import { apiRequest, apiRequestNoContent } from './api-client';

/**
 * Every call the client can make, one function each.
 *
 * Two rules hold across the whole file, and they are what keep the wire
 * contract load-bearing rather than decorative:
 *
 *  - **No path is written here.** Every URL comes from the contract's `ROUTES`
 *    table, including the parameterised ones.
 *  - **No shape is declared here.** Every response is parsed through a schema
 *    exported by the contract.
 *
 * Every function takes the calling seat's token explicitly. There is no ambient
 * "current user" in this app — that is the whole point of two seats.
 */

/** The user list, composed from the contract's own helpers exactly as the API composes it. */
export const userListSchema = paginated(userSummarySchema);

export type UserList = z.infer<typeof userListSchema>;

export function register(body: RegisterRequest): Promise<AuthSession> {
  return apiRequest({
    path: ROUTES.auth.register,
    method: 'POST',
    body,
    schema: authSessionSchema,
  });
}

export function login(body: LoginRequest): Promise<AuthSession> {
  return apiRequest({
    path: ROUTES.auth.login,
    method: 'POST',
    body,
    schema: authSessionSchema,
  });
}

/**
 * The identity the server currently attaches to this token.
 *
 * Used on mount to revalidate a token restored from `sessionStorage`. A token
 * whose user logged out elsewhere has had its `tokenVersion` bumped and no
 * longer verifies, so this is the only honest way to know a restored session is
 * still real — the client never inspects token contents.
 */
export function fetchMe(token: string, signal?: AbortSignal): Promise<AuthenticatedUser> {
  return apiRequest({
    path: ROUTES.auth.me,
    method: 'GET',
    token,
    schema: authenticatedUserSchema,
    signal,
  });
}

/** Revokes every token issued to this seat's user. */
export function logout(token: string): Promise<void> {
  return apiRequestNoContent({ path: ROUTES.auth.logout, method: 'POST', token });
}

/** The opponent picker's data source. Authenticated and paginated, server-side. */
export function listUsers(token: string, signal?: AbortSignal): Promise<UserList> {
  return apiRequest({
    path: ROUTES.users.list,
    method: 'GET',
    token,
    schema: userListSchema,
    signal,
  });
}

export function fetchGame(gameId: string, token: string, signal?: AbortSignal): Promise<GameView> {
  return apiRequest({
    path: ROUTES.games.byId(gameId),
    method: 'GET',
    token,
    schema: gameViewSchema,
    signal,
  });
}

export function createGame(token: string, body: CreateGameRequest): Promise<GameView> {
  return apiRequest({
    path: ROUTES.games.create,
    method: 'POST',
    token,
    body,
    schema: gameViewSchema,
  });
}

/**
 * The three gameplay commands.
 *
 * Note what they carry: `expectedRevision`, and for New Game an optional
 * winning score. No dice, no scores, no actor — there is no field here through
 * which this client could express an opinion about the rules even if it had
 * one.
 */
export function rollDice(gameId: string, token: string, body: RollRequest): Promise<GameView> {
  return apiRequest({
    path: ROUTES.games.roll(gameId),
    method: 'POST',
    token,
    body,
    schema: gameViewSchema,
  });
}

export function hold(gameId: string, token: string, body: HoldRequest): Promise<GameView> {
  return apiRequest({
    path: ROUTES.games.hold(gameId),
    method: 'POST',
    token,
    body,
    schema: gameViewSchema,
  });
}

export function newGame(gameId: string, token: string, body: NewGameRequest): Promise<GameView> {
  return apiRequest({
    path: ROUTES.games.newGame(gameId),
    method: 'POST',
    token,
    body,
    schema: gameViewSchema,
  });
}
