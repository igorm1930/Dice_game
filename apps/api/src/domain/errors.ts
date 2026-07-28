import { type Seat } from './seat';

/**
 * The domain's error taxonomy.
 *
 * Every error carries a stable, machine-readable `code` and knows **nothing**
 * about HTTP. The single code-to-status table lives in `@dice-game/contracts`
 * (`ERROR_STATUS`), where both sides of the wire can read it; the delivery layer
 * looks the code up there. Two consequences follow, and both are the point:
 *
 *  1. This core can be driven by an HTTP API today and by a queue consumer or a
 *     CLI tomorrow without touching a domain file.
 *  2. A status cannot drift, because there is exactly one place that decides it.
 *     The previous generation of this repository kept the mapping in an ADR
 *     *and* in a middleware, and they had already disagreed on four codes.
 *
 * The `code` values below are duplicated from the `ERROR_CODES` union in
 * `packages/contracts/src/errors.ts` on purpose — the domain may not import the
 * contract (the linter enforces it). `src/rules-contract-agreement.test.ts`
 * asserts the two sets still agree, so the duplication cannot rot silently.
 *
 * Note the absence of a stack-capture call: `Error.captureStackTrace` is a
 * V8-specific global, and the domain stays portable by not reaching for it.
 */
export abstract class DomainError extends Error {
  /** Stable identifier clients may branch on. Never change these casually. */
  abstract readonly code: string;

  /**
   * Machine-readable context for the caller. Must never contain a secret — it
   * is serialised into API responses verbatim.
   */
  readonly details: Readonly<Record<string, unknown>>;

  protected constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Raised when any action is attempted on a game that has already been won.
 *
 * The UI disables its buttons at that point, but the backend is the source of
 * truth — a client that bypasses the UI still cannot play a finished game.
 */
export class GameOverError extends DomainError {
  readonly code = 'GAME_OVER';

  constructor(action: string, winner: Seat | null) {
    super(
      `Cannot ${action}: this game has already been won by player ${String(winner)}. Start a new game first.`,
      { action, winner },
    );
  }
}

/** Raised when an authenticated user who is not seated tries to act. */
export class NotAParticipantError extends DomainError {
  readonly code = 'NOT_A_PARTICIPANT';

  constructor(userId: string) {
    super('You are not one of the two players in this game.', { userId });
  }
}

/**
 * Raised when a seated player acts out of turn.
 *
 * This is the rule that makes "the API validates turns" true rather than
 * aspirational: turn order is enforced against the caller's *identity*, so no
 * amount of clicking in the wrong browser tab can steal a turn.
 */
export class NotYourTurnError extends DomainError {
  readonly code = 'NOT_YOUR_TURN';

  constructor(action: string, actor: Seat, activePlayer: Seat) {
    super(`Cannot ${action}: it is player ${activePlayer}'s turn.`, {
      action,
      actor,
      activePlayer,
    });
  }
}

/** Raised when a game is created or restarted with an unplayable winning score. */
export class InvalidTargetScoreError extends DomainError {
  readonly code = 'INVALID_TARGET_SCORE';

  constructor(requested: number, minimum: number, maximum: number) {
    super(`Winning score ${requested} must be an integer between ${minimum} and ${maximum}.`, {
      requested,
      minimum,
      maximum,
    });
  }
}

/** Raised when a player tries to start a match against themselves. */
export class InvalidOpponentError extends DomainError {
  readonly code = 'INVALID_OPPONENT';

  constructor(userId: string) {
    super('A player cannot play against themselves; name a different opponent.', { userId });
  }
}

/**
 * Raised when a game references a ruleset the registry does not allow-list.
 *
 * Reachable two ways, and both must fail closed: a client naming a ruleset that
 * does not exist, and a stored game whose `ruleset` field no longer resolves
 * because the code that implemented it was withdrawn.
 */
export class UnsupportedRulesetError extends DomainError {
  readonly code = 'UNSUPPORTED_RULESET';

  constructor(ref: { readonly id: string; readonly version: number }) {
    super(`Ruleset '${ref.id}@${ref.version}' is not supported.`, {
      id: ref.id,
      version: ref.version,
    });
  }
}
