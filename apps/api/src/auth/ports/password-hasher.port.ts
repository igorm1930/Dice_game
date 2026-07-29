/**
 * Password hashing, stated as the two operations the application needs.
 *
 * A **port**, for the usual reason — the service is testable without spending
 * Argon2's memory budget on every unit test — and for one less usual one: the
 * anti-enumeration property below is about *how many times* verification runs,
 * which is exactly what a hand-written counting fake can assert and a real hasher
 * cannot.
 */
export interface PasswordHasher {
  /** Returns a self-describing digest (PHC string) carrying its own parameters. */
  hash(plain: string): Promise<string>;

  /**
   * Whether `plain` produced `hash`.
   *
   * Argument order is `(hash, plain)` — the stored value first, the untrusted
   * value second. Implementations must return `false` for a malformed digest
   * rather than throwing: the login path deliberately feeds this a dummy digest,
   * and a throw there would be observably different from a wrong password.
   */
  verify(hash: string, plain: string): Promise<boolean>;
}

/** DI token for the hasher. Bound to `Argon2PasswordHasher`. */
export const PASSWORD_HASHER = 'PASSWORD_HASHER';

/**
 * DI token for a digest of a password nobody knows.
 *
 * **Login is not an enumeration oracle.** When no account matches the submitted
 * email, the service still runs a full verification — against this digest — so
 * the unknown-email path costs what the wrong-password path costs. Without it,
 * "no such account" returns in microseconds and "wrong password" in tens of
 * milliseconds, and the difference is a membership test anyone can run.
 *
 * It is provided by an **async factory**, which is what makes it *eager*: Nest
 * awaits async providers while building the container, so the hash is computed
 * once at boot, before the process accepts its first request. A lazily memoised
 * dummy would make the very first unknown-email login measurably slower than
 * every later one — a signal that the account does not exist, reintroduced by
 * the very code meant to remove it.
 */
export const DUMMY_PASSWORD_HASH = 'DUMMY_PASSWORD_HASH';
