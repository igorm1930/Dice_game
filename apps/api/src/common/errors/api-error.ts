import { type ErrorCode } from '@dice-game/contracts';

/**
 * A delivery-layer error that carries a contract error code and, like
 * `DomainError`, no HTTP status.
 *
 * The domain has its own error hierarchy (`src/domain/errors.ts`) and cannot
 * import the contract — the linter forbids it. This is the mirror for
 * everything *outside* the domain: a failed token check, a malformed body, a
 * missing route. The status still comes from one place only, `ERROR_STATUS` in
 * `@dice-game/contracts`, resolved by `DomainExceptionFilter`.
 *
 * Throw one of these rather than a Nest `HttpException`. A bare
 * `ForbiddenException` reaches the filter with a status but no contract code,
 * and the filter deliberately refuses to guess one.
 */
export class ApiError extends Error {
  /** Stable identifier the client may branch on. */
  readonly code: ErrorCode;

  /**
   * Machine-readable context, serialised into the response verbatim. Must never
   * contain a credential, a hash, a token or a connection string.
   */
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(code: ErrorCode, message: string, details?: Readonly<Record<string, unknown>>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.details = details === undefined ? undefined : Object.freeze({ ...details });
  }
}

/** A request whose shape did not satisfy the contract schema. */
export class ValidationError extends ApiError {
  constructor(details: Readonly<Record<string, unknown>>) {
    super('VALIDATION_ERROR', 'The request did not match the expected shape.', details);
  }
}

/** A body that was not parseable at all — malformed JSON, wrong content type. */
export class MalformedRequestBodyError extends ApiError {
  constructor(reason = 'The request body could not be parsed.') {
    super('MALFORMED_REQUEST_BODY', reason);
  }
}

/**
 * No usable credential was presented.
 *
 * Deliberately the same for a missing token, an expired token, a forged
 * signature and a revoked `tokenVersion`: which one it was is exactly the
 * information an attacker wants.
 */
export class UnauthenticatedError extends ApiError {
  constructor(message = 'Authentication is required for this endpoint.') {
    super('UNAUTHENTICATED', message);
  }
}

/** Nothing is mounted at the requested path. */
export class RouteNotFoundError extends ApiError {
  constructor(method: string, path: string) {
    super('ROUTE_NOT_FOUND', `No route matches ${method} ${path}.`, { method, path });
  }
}

/** The body exceeded `BODY_LIMIT`. */
export class PayloadTooLargeError extends ApiError {
  constructor(limit: string) {
    super('PAYLOAD_TOO_LARGE', `Request body exceeds the ${limit} limit.`, { limit });
  }
}

/** The caller exhausted its rate-limit budget. */
export class RateLimitExceededError extends ApiError {
  constructor(message = 'Too many requests. Wait a moment and try again.') {
    super('RATE_LIMIT_EXCEEDED', message);
  }
}
