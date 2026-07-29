import { idSchema } from '@dice-game/contracts';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';

import { UnauthenticatedError } from '../common/errors/api-error';
import { type UserRecord } from './user.entity';

/**
 * Issuing and verifying access tokens, in one place.
 *
 * The guard verifies and the service signs; putting both here means the claim
 * set is declared once. A token whose `tokenVersion` claim was written by one
 * file and read by another — under a slightly different name — is a revocation
 * check that silently passes everything.
 */

/**
 * What a token asserts, and the whole of it.
 *
 * Two claims. Not the email, not the display name, not a role: every one of
 * those would be a copy of state that can change, and the guard reloads the user
 * on every request anyway. A token that carries a display name is a token that
 * shows a stale one for fifteen minutes after a rename.
 *
 * `sub` is validated against the contract's `idSchema` rather than `z.string()`,
 * so a forged-but-correctly-signed token (a leaked secret, a test double left in
 * a deploy) still cannot smuggle an arbitrary string into a database lookup.
 */
export const accessTokenClaimsSchema = z.object({
  sub: idSchema,
  tokenVersion: z.number().int().nonnegative(),
});

export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;

/** The claim set plus the timestamps `jsonwebtoken` adds while signing. */
const signedTokenSchema = accessTokenClaimsSchema.extend({
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
});

export interface IssuedAccessToken {
  readonly accessToken: string;
  /** Lifetime in seconds, as `authSessionSchema` requires. */
  readonly expiresIn: number;
}

@Injectable()
export class AccessTokenService {
  constructor(private readonly jwt: JwtService) {}

  /**
   * Signs a token for this user, at their current `tokenVersion`.
   *
   * `expiresIn` is derived by reading `exp - iat` back off the token just signed
   * rather than by parsing `JWT_EXPIRES_IN` here. The configuration value is a
   * duration string (`15m`, `900s`, `7d`) whose interpretation belongs to
   * `jsonwebtoken`; re-implementing that parser is how the number the client is
   * told and the moment the token actually dies drift apart. The client never
   * inspects the token itself — that is the point of sending `expiresIn` at all.
   */
  async issue(user: UserRecord): Promise<IssuedAccessToken> {
    const claims: AccessTokenClaims = { sub: user.id, tokenVersion: user.tokenVersion };
    const accessToken = await this.jwt.signAsync(claims);
    const signed = signedTokenSchema.safeParse(this.jwt.decode<unknown>(accessToken));

    if (!signed.success) {
      // Unreachable unless the signing configuration changed shape underneath
      // us. An opaque 500 and a loud log line is the right answer to that; a
      // guessed lifetime is not.
      throw new Error('Signed an access token that does not carry the expected claims.');
    }

    const expiresIn = signed.data.exp - signed.data.iat;

    if (expiresIn <= 0) {
      throw new Error(
        'JWT_EXPIRES_IN yields a token that is already expired when issued. Set a positive duration.',
      );
    }

    return { accessToken, expiresIn };
  }

  /**
   * The claims of a valid, unexpired, correctly signed token.
   *
   * Every failure — bad signature, expired, wrong algorithm, claims that do not
   * match the schema — raises the same `UnauthenticatedError` with the same
   * message. Which one it was is precisely what an attacker is probing for, and
   * the operator gets the detail from the log line instead.
   *
   * This does **not** establish that the caller is still authenticated: the
   * `tokenVersion` comparison against stored state is the guard's job, and a
   * token that verifies here may still be revoked.
   */
  async verify(token: string): Promise<AccessTokenClaims> {
    const payload = await this.jwt
      .verifyAsync<Record<string, unknown>>(token)
      .catch(() => null as Record<string, unknown> | null);

    if (payload === null) {
      throw new UnauthenticatedError();
    }

    const claims = accessTokenClaimsSchema.safeParse(payload);

    if (!claims.success) {
      throw new UnauthenticatedError();
    }

    return claims.data;
  }
}
