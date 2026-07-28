import type { Clock } from '../../src/core/ports/clock.port';
import type { IdGenerator } from '../../src/core/ports/id-generator.port';
import type { PasswordHasher } from '../../src/core/ports/password-hasher.port';
import type { RandomGenerator } from '../../src/core/ports/random-generator.port';

/**
 * Test doubles for the non-deterministic ports.
 *
 * These exist because randomness, time, and identity are injected rather than
 * imported. Every assertion about a score, a timestamp, or an id is exact as a
 * result — there is not a single `expect.any(Number)` in the suite.
 */

/** Replays a scripted sequence of die values, cycling when exhausted. */
export class ScriptedRandomGenerator implements RandomGenerator {
  private cursor = 0;

  constructor(private readonly sequence: readonly number[]) {
    if (sequence.length === 0) {
      throw new Error('ScriptedRandomGenerator requires a non-empty sequence.');
    }
  }

  nextInt(min: number, max: number): number {
    const value = this.sequence[this.cursor % this.sequence.length];
    this.cursor += 1;

    if (value === undefined || value < min || value > max) {
      throw new Error(
        `Scripted value ${String(value)} is outside the requested range [${min}, ${max}].`,
      );
    }

    return value;
  }

  get callCount(): number {
    return this.cursor;
  }
}

/** Always returns the same value — useful for asserting a specific outcome. */
export class ConstantRandomGenerator implements RandomGenerator {
  constructor(private readonly value: number) {}

  nextInt(): number {
    return this.value;
  }
}

/** A clock frozen at a fixed instant, advanceable on demand. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: string | Date = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(initial);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

/** Deterministic, valid UUIDs so `.uuid()` validation still exercises properly. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  generate(): string {
    this.counter += 1;
    const suffix = this.counter.toString(16).padStart(12, '0');
    return `00000000-0000-4000-8000-${suffix}`;
  }
}

/**
 * A hasher that is honest about its contract but costs nothing.
 *
 * The shipped `ScryptPasswordHasher` is deliberately slow — around 100 ms per
 * call, which is the point of a KDF and also the reason a suite that registers
 * dozens of players cannot use it. This double preserves the two properties the
 * services actually depend on (a hash round-trips; a wrong password fails)
 * while running in microseconds. The real adapter has its own dedicated tests.
 */
export class FakePasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<string> {
    return Promise.resolve(`fake$${Buffer.from(plaintext).toString('base64')}`);
  }

  async verify(plaintext: string, stored: string): Promise<boolean> {
    return (await this.hash(plaintext)) === stored;
  }
}
