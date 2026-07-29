import { ApiError } from '../common/errors/api-error';

/**
 * Authentication failures, as contract error codes.
 *
 * Both extend `ApiError` rather than a Nest `HttpException`, so the status comes
 * from `ERROR_STATUS` in `@dice-game/contracts` and nowhere else — see
 * `DomainExceptionFilter`.
 */

/**
 * The single message every failed login returns.
 *
 * Exported so a test can assert the string is shared rather than merely equal by
 * coincidence. It names neither the email nor the field that failed: "no such
 * account" and "wrong password" must be indistinguishable, or the endpoint tells
 * an attacker which addresses are registered.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Email or password is incorrect.';

/**
 * A login that did not succeed. For *any* reason.
 *
 * Carries no `details`. A field-level hint here — `{ field: 'password' }` — would
 * undo the whole property: it would confirm the email exists.
 */
export class InvalidCredentialsError extends ApiError {
  constructor() {
    super('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }
}

/**
 * Registration against an address that already has an account.
 *
 * Registration necessarily reveals that an address is taken — that is the
 * endpoint's purpose, and the contract gives the outcome its own code. The
 * details are still empty: echoing the submitted address back is a small
 * reflected-content habit worth not having.
 *
 * Raised by the repository, not by a read-then-write in the service, because
 * only the repository can make the check and the insert atomic. Phase 4 maps
 * MongoDB's duplicate-key error (E11000) on the unique email index onto this.
 */
export class EmailTakenError extends ApiError {
  constructor() {
    super('EMAIL_TAKEN', 'An account already exists for that email address.');
  }
}
