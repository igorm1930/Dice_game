import { z } from 'zod';

import { displayNameSchema, emailSchema, idSchema, passwordSchema } from './primitives.js';

/**
 * Authentication contract.
 *
 * Two properties the implementation must preserve, both inherited from the
 * previous generation and both asserted by tests:
 *
 *  - **Login is not an enumeration oracle.** An unknown email and a wrong
 *    password return the same body *and* cost the same CPU — the unknown-email
 *    path performs a throwaway hash verification so the timing does not leak
 *    which accounts exist.
 *  - **Identity is never taken from a request body.** No endpoint anywhere in
 *    this contract accepts an actor id. The acting user is always derived from
 *    the verified token.
 */

export const registerRequestSchema = z
  .object({
    email: emailSchema,
    displayName: displayNameSchema,
    password: passwordSchema,
  })
  .strict();

export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** The authenticated user, as they see themselves. */
export const authenticatedUserSchema = z.object({
  id: idSchema,
  email: emailSchema,
  displayName: displayNameSchema,
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;

/**
 * A successful register or login.
 *
 * The access token is short-lived and held per seat in `sessionStorage`, not in
 * a cookie: two distinct identities share one browser origin on the same page,
 * so a cookie session cannot represent both seats at once. The XSS trade-off
 * that follows is documented in docs/security.md.
 *
 * `expiresIn` is seconds, so the client can refresh or warn before expiry
 * without parsing the token — the client never inspects token contents.
 */
export const authSessionSchema = z.object({
  accessToken: z.string().min(1),
  expiresIn: z.number().int().positive(),
  user: authenticatedUserSchema,
});

export type AuthSession = z.infer<typeof authSessionSchema>;
