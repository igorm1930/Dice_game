/**
 * Credential issuing boundary.
 *
 * The core knows only that a token maps to a user id and can expire. Whether
 * that is an opaque server-side session (what ships — see ADR-0007) or a signed
 * JWT is entirely the adapter's business, so moving to stateless verification
 * when a second replica appears touches one file.
 */
export interface AuthTokenService {
  /** Issues a fresh credential for the given player. */
  issue(userId: string): Promise<string>;

  /** Resolves a credential to a user id, or `null` if invalid or expired. */
  resolve(token: string): Promise<string | null>;

  /** Invalidates a credential. Idempotent — revoking an unknown token is a no-op. */
  revoke(token: string): Promise<void>;
}
