import { type Readiness } from '@dice-game/contracts';

/** `'up' | 'down'`, as the contract's readiness payload spells it. */
export type ReadinessStatus = Readiness['checks']['mongo'];

/**
 * A dependency this instance needs before it should be sent traffic.
 *
 * A **port**: the health module states what it needs to know and nothing about
 * how the answer is obtained. `MongoReadinessIndicator` is bound to
 * {@link MONGO_READINESS_INDICATOR} and pings the database; replacing the Phase
 * 3 stub that always answered `'up'` changed that one binding and nothing else.
 *
 * Implementations must not throw and must not block: this is polled every few
 * seconds by an orchestrator that will restart the process if it stops
 * answering. Report `'down'` instead.
 */
export interface ReadinessIndicator {
  check(): Promise<ReadinessStatus>;
}

/**
 * DI token for the MongoDB readiness check.
 *
 * ```ts
 * // health.module.ts:
 * { provide: MONGO_READINESS_INDICATOR, useClass: MongoReadinessIndicator }
 * ```
 */
export const MONGO_READINESS_INDICATOR = 'MONGO_READINESS_INDICATOR';
