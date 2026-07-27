/**
 * Source of randomness.
 *
 * A port rather than a direct `Math.random()` call so tests can supply a
 * scripted sequence and assert exact scores. Without this seam every test that
 * touches a roll is probabilistic, and probabilistic tests are flaky tests.
 */
export interface RandomGenerator {
  /**
   * Returns a uniformly distributed integer in `[min, max]` (both inclusive).
   */
  nextInt(min: number, max: number): number;
}
