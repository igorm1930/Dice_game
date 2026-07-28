import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from '../../core/ports/password-hasher.port';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Encoding prefix, so a stored hash names the scheme that produced it. */
const SCHEME = 'scrypt';
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * scrypt parameters. `N = 2^15` is the current OWASP floor for scrypt and costs
 * roughly 100 ms on the deployed machine class — slow enough that offline
 * cracking is expensive, fast enough that a login is not a user-visible pause.
 *
 * They are encoded into every stored hash rather than read from configuration
 * at verify time, so raising the cost later re-hashes new passwords without
 * invalidating existing ones.
 */
const PARAMS = { N: 32_768, r: 8, p: 1 } as const;

/** scrypt needs ~128 * N * r bytes; the default 32 MB cap is below that at N=2^15. */
const MAX_MEM = 128 * PARAMS.N * PARAMS.r * 2;

/**
 * Password hashing with `node:crypto`'s scrypt.
 *
 * Chosen over bcrypt/argon2 because both are native modules: they would add a
 * compiler to the build image and a class of "works locally, fails in the
 * container" failure this project deliberately avoids. scrypt is memory-hard,
 * in the standard library, and behind a port — so argon2id is a swap of this
 * one file if the operational cost of a native dependency is ever accepted.
 */
export class ScryptPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const derived = await scryptAsync(plaintext, salt, KEY_BYTES, { ...PARAMS, maxmem: MAX_MEM });

    return [
      SCHEME,
      String(PARAMS.N),
      String(PARAMS.r),
      String(PARAMS.p),
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async verify(plaintext: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) {
      // A corrupt or foreign hash is a failed login, never a 500 — an
      // unparseable record must not become an availability problem.
      return false;
    }

    const derived = await scryptAsync(plaintext, parsed.salt, parsed.expected.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: 128 * parsed.N * parsed.r * 2,
    });

    // Lengths are equal by construction above, so timingSafeEqual cannot throw.
    return timingSafeEqual(derived, parsed.expected);
  }
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly expected: Buffer;
}

function parse(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== SCHEME) {
    return null;
  }

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);

  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return null;
  }

  const expected = Buffer.from(rawHash, 'base64');
  if (expected.length === 0) {
    return null;
  }

  return { N, r, p, salt: Buffer.from(rawSalt, 'base64'), expected };
}
