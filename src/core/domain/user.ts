import { DomainError } from './errors';

/**
 * Player identity.
 *
 * The API "manages the identities of the players", so a player is a first-class
 * domain concept rather than a string the client asserts about itself. Every
 * game seat references a `User.id`, and every action is attributed to the
 * identity behind the credential — never to a value in the request body.
 */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Letters, digits, underscore, hyphen. Deliberately narrow and unambiguous. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface User {
  readonly id: string;
  /** As the player typed it — what the UI shows. */
  readonly username: string;
  /**
   * Case-folded uniqueness key. `Alice` and `alice` are the same player; storing
   * the key explicitly keeps that rule in one place instead of leaving every
   * lookup to remember to lowercase.
   */
  readonly usernameKey: string;
  /** Opaque to the domain — its format is the hasher adapter's business. */
  readonly passwordHash: string;
  /** Extra #1: how many games this player has won. */
  readonly wins: number;
  readonly createdAt: string;
}

/** The public projection of a player. Never carries the password hash. */
export interface PlayerIdentity {
  readonly id: string;
  readonly username: string;
  readonly wins: number;
}

export function toPlayerIdentity(user: User): PlayerIdentity {
  return { id: user.id, username: user.username, wins: user.wins };
}

export function usernameKeyOf(username: string): string {
  return username.trim().toLowerCase();
}

/** Raised when a registration collides with an existing player. */
export class UsernameTakenError extends DomainError {
  readonly code = 'USERNAME_TAKEN';

  constructor(username: string) {
    super(`The username '${username}' is already registered.`, { username });
  }
}

/**
 * Raised for both "no such user" and "wrong password".
 *
 * Deliberately one error with one message: distinguishing them turns the login
 * endpoint into a username oracle, letting an attacker enumerate accounts
 * before ever guessing a password.
 */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Username or password is incorrect.');
  }
}

/** Raised when a protected action arrives without a usable credential. */
export class UnauthenticatedError extends DomainError {
  readonly code = 'UNAUTHENTICATED';

  constructor(reason: string) {
    super(`Authentication required: ${reason}`, { reason });
  }
}

/** Raised when a named player does not exist — e.g. an unknown opponent. */
export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';

  constructor(username: string) {
    super(`No player named '${username}' is registered.`, { username });
  }
}
