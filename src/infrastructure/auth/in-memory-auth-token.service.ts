import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { AuthTokenService } from '../../core/ports/auth-token.port';
import type { Clock } from '../../core/ports/clock.port';

/** 256 bits of entropy — far beyond guessable, and URL-safe on the wire. */
const TOKEN_BYTES = 32;

interface Session {
  readonly userId: string;
  readonly expiresAtMs: number;
}

export interface InMemoryAuthTokenServiceOptions {
  readonly clock: Clock;
  readonly ttlMs: number;
}

/**
 * Opaque server-side sessions (see ADR-0007).
 *
 * A JWT would be the reflexive choice here and would be the wrong one: its
 * whole advantage is stateless verification across instances, and this service
 * runs as a single replica whose user store is itself in memory. It would buy
 * nothing while adding a signing key to manage and taking away revocation.
 *
 * So: a random opaque token, looked up in a Map. Revocation is a delete,
 * expiry is a timestamp, and nothing is signed because nothing leaves the
 * process. When a shared store arrives, this adapter is the only file that
 * changes — the port already says "token in, user id out".
 */
export class InMemoryAuthTokenService implements AuthTokenService {
  private readonly sessions = new Map<string, Session>();
  private readonly clock: Clock;
  private readonly ttlMs: number;

  constructor(options: InMemoryAuthTokenServiceOptions) {
    this.clock = options.clock;
    this.ttlMs = options.ttlMs;
  }

  issue(userId: string): Promise<string> {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    this.sessions.set(token, {
      userId,
      expiresAtMs: this.clock.now().getTime() + this.ttlMs,
    });

    // Amortised cleanup: expired entries are dropped as sessions are created,
    // so a long-running process cannot accumulate dead tokens without bound and
    // no background timer is needed to prevent it.
    this.sweep();

    return Promise.resolve(token);
  }

  resolve(token: string): Promise<string | null> {
    const session = this.lookup(token);

    if (!session) {
      return Promise.resolve(null);
    }

    if (session.expiresAtMs <= this.clock.now().getTime()) {
      this.sessions.delete(token);
      return Promise.resolve(null);
    }

    return Promise.resolve(session.userId);
  }

  revoke(token: string): Promise<void> {
    this.sessions.delete(token);
    return Promise.resolve();
  }

  /**
   * Constant-time lookup.
   *
   * `Map.get` on an attacker-supplied key is a hash comparison, which leaks a
   * little through timing. Scanning every session and comparing with
   * `timingSafeEqual` removes that channel; with a two-player game the set is
   * tiny, and the port's contract is unchanged if this ever needs to become an
   * indexed lookup against a real store.
   */
  private lookup(token: string): Session | undefined {
    const candidate = Buffer.from(token);
    let found: Session | undefined;

    for (const [stored, session] of this.sessions) {
      const storedBuffer = Buffer.from(stored);
      if (
        storedBuffer.length === candidate.length &&
        timingSafeEqual(storedBuffer, candidate) &&
        !found
      ) {
        found = session;
      }
    }

    return found;
  }

  private sweep(): void {
    const nowMs = this.clock.now().getTime();
    for (const [token, session] of this.sessions) {
      if (session.expiresAtMs <= nowMs) {
        this.sessions.delete(token);
      }
    }
  }
}
