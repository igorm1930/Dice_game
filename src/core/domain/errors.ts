/**
 * Domain error taxonomy.
 *
 * These carry a stable machine-readable `code` and deliberately know NOTHING
 * about HTTP. Mapping a code to a status belongs to the delivery layer
 * (`src/http/middleware/error-handler.middleware.ts`). That separation is what
 * lets this core be driven by an HTTP API today and a queue consumer or CLI
 * tomorrow without touching a single domain file.
 */
export abstract class DomainError extends Error {
  /** Stable identifier clients may branch on. Never change these casually. */
  abstract readonly code: string;

  /**
   * Machine-readable context for the caller. Must never contain secrets — it
   * is serialised into API responses verbatim.
   */
  readonly details: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = Object.freeze({ ...details });
    Error.captureStackTrace?.(this, new.target);
  }
}

export class GameNotFoundError extends DomainError {
  readonly code = 'GAME_NOT_FOUND';

  constructor(gameId: string) {
    super(`Game '${gameId}' was not found.`, { gameId });
  }
}

export class GameAlreadyCompletedError extends DomainError {
  readonly code = 'GAME_ALREADY_COMPLETED';

  constructor(gameId: string, totalRounds: number) {
    super(
      `Game '${gameId}' has already played all ${totalRounds} of its rounds and cannot be rolled again.`,
      { gameId, totalRounds },
    );
  }
}

export class InvalidRoundCountError extends DomainError {
  readonly code = 'INVALID_ROUND_COUNT';

  constructor(requested: number, maxRounds: number) {
    super(`Requested round count ${requested} must be between 1 and ${maxRounds}.`, {
      requested,
      maxRounds,
    });
  }
}

/**
 * Raised when a write is attempted against a stale snapshot of an aggregate.
 *
 * Signals a lost update was prevented. The caller is expected to re-read and
 * retry; the HTTP layer surfaces this as a 409.
 */
export class ConcurrencyConflictError extends DomainError {
  readonly code = 'CONCURRENCY_CONFLICT';

  constructor(gameId: string, expectedVersion: number, actualVersion: number) {
    super(
      `Game '${gameId}' was modified concurrently (expected version ${expectedVersion}, found ${actualVersion}).`,
      { gameId, expectedVersion, actualVersion },
    );
  }
}
