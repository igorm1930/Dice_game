import { type AuthenticatedUser, type UserSummary } from '@dice-game/contracts';

/**
 * A user, as this application stores one.
 *
 * A plain record with no framework decorators and no persistence concerns: it is
 * neither a Mongoose schema nor a Nest provider, so the service and the guard can
 * be tested without a database and Phase 4 can introduce a Mongoose document that
 * *maps to* this shape rather than replacing it everywhere.
 *
 * `passwordHash` is the reason the projections below exist. It is the one field
 * that must never leave the process, and the only way to leak it is to serialise
 * a `UserRecord` directly — so nothing outside this layer ever sees one. Handlers
 * return `AuthenticatedUser` or `UserSummary`, both declared in the contract.
 *
 * `tokenVersion` is what makes logout real rather than cosmetic. It is minted
 * into every access token and re-read from storage on every request; bumping it
 * invalidates every token issued so far. See `JwtAuthGuard`.
 */
export interface UserRecord {
  /** 24-character hex id, matching the contract's `idSchema`. */
  readonly id: string;
  /** Normalised: trimmed and lower-cased, as `emailSchema` produces. */
  readonly email: string;
  readonly displayName: string;
  /** An Argon2id PHC string. Never serialised, never logged, never compared by `===`. */
  readonly passwordHash: string;
  /** Incremented by logout. Compared against the token's claim on every request. */
  readonly tokenVersion: number;
  readonly createdAt: Date;
}

/**
 * The user as they see themselves: `/api/auth/me`, and the `user` field of a
 * register or login response.
 *
 * Written as an explicit object literal rather than a spread-and-delete, so a
 * field added to `UserRecord` later is *absent by default* instead of leaking
 * until somebody notices.
 */
export function toAuthenticatedUser(user: UserRecord): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
  };
}

/**
 * The user as *other* users see them: the opponent picker's row.
 *
 * Two fields, and deliberately not three. No email — an authenticated,
 * paginated list that includes email addresses is still an address-harvesting
 * endpoint. `packages/contracts/src/users.ts` is the authority on this shape.
 */
export function toUserSummary(user: UserRecord): UserSummary {
  return {
    id: user.id,
    displayName: user.displayName,
  };
}
