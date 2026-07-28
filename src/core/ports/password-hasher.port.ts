/**
 * Password hashing boundary.
 *
 * A port rather than a direct `node:crypto` call for two reasons. First, the
 * choice of KDF is an operational decision that will change (scrypt today,
 * argon2id when a native dependency is acceptable) and should not be welded
 * into the service. Second, a deliberately slow KDF is deliberately slow in
 * tests too — the suite injects a fast fake and stays in milliseconds without
 * ever weakening the real parameters.
 */
export interface PasswordHasher {
  /** Returns a self-describing string containing the algorithm, salt and hash. */
  hash(plaintext: string): Promise<string>;

  /**
   * Verifies a candidate against a stored hash.
   *
   * Must be constant-time with respect to the hash contents and must return
   * `false` — never throw — for an unparseable stored value.
   */
  verify(plaintext: string, stored: string): Promise<boolean>;
}
