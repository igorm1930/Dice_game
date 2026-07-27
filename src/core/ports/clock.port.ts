/**
 * Source of the current time.
 *
 * Injected for the same reason as randomness: timestamps that come from an
 * ambient `new Date()` cannot be asserted on, and tests that assert on them
 * become time-of-day dependent.
 */
export interface Clock {
  now(): Date;
}
