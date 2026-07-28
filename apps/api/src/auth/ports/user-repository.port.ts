import { type UserRecord } from '../user.entity';

/**
 * How this application stores users, stated as five operations and nothing else.
 *
 * A **port**: the auth and users modules say what they need to know, and say
 * nothing about how the answer is obtained. Phase 3 binds
 * `InMemoryUserRepository`; Phase 4 binds a Mongoose adapter to the same token
 * and no consumer changes. Every method is asynchronous for that reason — an
 * in-memory `Map` does not need to be, but a driver does, and a port that is
 * synchronous today cannot be backed by a database tomorrow.
 */

/** The fields a caller supplies when creating a user; the rest are the store's. */
export interface NewUser {
  /** Already normalised by `emailSchema` (trimmed, lower-cased). */
  readonly email: string;
  readonly displayName: string;
  /** Already hashed. A plaintext password never reaches this port. */
  readonly passwordHash: string;
}

/** A bounded window over the user list. Both values are required: see `list`. */
export interface ListUsersOptions {
  readonly limit: number;
  readonly offset: number;
}

/**
 * One page, plus the size of the whole collection.
 *
 * `total` is what lets the client render "showing 25 of 312" and decide whether
 * to offer a next page, and it is why `list` cannot simply return an array.
 */
export interface UserPage {
  readonly items: readonly UserRecord[];
  readonly total: number;
}

export interface UserRepository {
  /** The user with this id, or `null`. Never throws for "not found". */
  findById(id: string): Promise<UserRecord | null>;

  /**
   * The user with this email, or `null`.
   *
   * Matching is on the normalised (trimmed, lower-cased) form, so
   * `Ada@Example.com` and `ada@example.com` are one account rather than two.
   */
  findByEmail(email: string): Promise<UserRecord | null>;

  /**
   * Stores a new user and returns the stored record, `id` and all.
   *
   * @throws {EmailTakenError} when the address is already registered. The check
   * lives here rather than in the service because only the store can make it
   * atomic with the insert; a read-then-write in the service is a race that two
   * simultaneous registrations win.
   */
  create(user: NewUser): Promise<UserRecord>;

  /**
   * Bumps `tokenVersion`, invalidating every access token issued so far.
   *
   * Returns the new version, or `null` when there is no such user. Returning
   * rather than throwing keeps "the account was deleted while its token was
   * still valid" a caller's decision — the auth service turns it into a 401.
   */
  incrementTokenVersion(id: string): Promise<number | null>;

  /**
   * A page of users, in a stable order.
   *
   * There is deliberately no unbounded variant. `limit` and `offset` are
   * required, not optional with a generous default: an endpoint that can be
   * asked for every user is an enumeration endpoint, and the easiest way to grow
   * one by accident is to leave a "list everything" method lying around.
   */
  list(options: ListUsersOptions): Promise<UserPage>;
}

/**
 * DI token for the user store.
 *
 * ```ts
 * constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}
 * ```
 */
export const USER_REPOSITORY = 'USER_REPOSITORY';
