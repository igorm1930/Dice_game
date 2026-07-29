/**
 * The one MongoDB error code this application interprets.
 *
 * `E11000 duplicate key error` is what a unique index raises when an insert
 * would violate it. It is not an incident: for the users collection it *is* the
 * uniqueness check, performed atomically by the server, and the repository turns
 * it into `EmailTakenError`.
 */
export const DUPLICATE_KEY_ERROR_CODE = 11000;

/**
 * True when this error is a unique-index violation.
 *
 * Duck-typed rather than `instanceof MongoServerError`. Two reasons, and both
 * have bitten real deployments: a workspace can end up with more than one copy
 * of the driver, and `instanceof` across two copies is silently false; and the
 * same code arrives on several error classes (`MongoServerError`,
 * `MongoBulkWriteError`, and mongoose's own wrapper) depending on the operation.
 * A missed duplicate here would surface as a 500 on a perfectly ordinary
 * "that email is taken", so the check fails *safe* rather than fails narrow.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === DUPLICATE_KEY_ERROR_CODE
  );
}
