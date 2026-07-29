import { Inject, Injectable } from '@nestjs/common';
import { argon2id, hash as argon2Hash, type HashOptions, verify as argon2Verify } from 'argon2';

import { APP_CONFIG } from '../../config/config.module';
import { type AppConfig } from '../../config/env.schema';
import { type PasswordHasher } from '../ports/password-hasher.port';

/**
 * Argon2id, with cost parameters from validated configuration.
 *
 * Argon2**id** rather than argon2i or argon2d: it is the hybrid the RFC 9106
 * recommends by default, resistant both to GPU parallelism and to side-channel
 * attacks on the memory access pattern. The variant is set explicitly rather
 * than left to the library's default, because "whatever the dependency picked
 * this major version" is not a security decision anybody made.
 *
 * The cost comes from `ARGON2_MEMORY_KIB`, `ARGON2_TIME_COST` and
 * `ARGON2_PARALLELISM` — bounded in `env.schema.ts`, defaulting to the 19 MiB /
 * t=2 / p=1 profile RFC 9106 gives for memory-constrained environments. Nothing
 * here re-reads `process.env` or supplies a fallback: an unset variable was
 * already defaulted, and an out-of-range one already stopped the process.
 *
 * A digest is a PHC string that carries its own parameters, so raising the cost
 * later does not invalidate existing hashes — `verify` reads them from the
 * digest, and only `hash` uses the configured values.
 */
@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  private readonly options: HashOptions;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const { memoryCostKib, timeCost, parallelism } = config.auth.argon2;

    this.options = {
      type: argon2id,
      memoryCost: memoryCostKib,
      timeCost,
      parallelism,
    };
  }

  hash(plain: string): Promise<string> {
    return argon2Hash(plain, this.options);
  }

  /**
   * Parameters are read from the digest, not from configuration, so this is
   * deliberately called without `this.options`.
   *
   * A malformed or truncated digest makes the library throw. That is turned into
   * `false` here because the caller cannot be allowed to tell the difference:
   * the login path verifies against a dummy digest when no account matches, and
   * an exception escaping from that branch would be exactly the signal the dummy
   * exists to suppress.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2Verify(hash, plain);
    } catch {
      return false;
    }
  }
}
