import {
  type AuthenticatedUser,
  type AuthSession,
  type LoginRequest,
  type RegisterRequest,
} from '@dice-game/contracts';
import { Inject, Injectable } from '@nestjs/common';

import { UnauthenticatedError } from '../common/errors/api-error';
import { type RequestUser } from '../common/http/request-context';
import { AccessTokenService } from './access-token.service';
import { InvalidCredentialsError } from './auth.errors';
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import { USER_REPOSITORY, type UserRepository } from './ports/user-repository.port';
import { toAuthenticatedUser, type UserRecord } from './user.entity';

/**
 * Registration, login, logout and "who am I".
 *
 * Nothing here takes an actor id as data. `logout` and `me` receive a
 * `RequestUser` — the identity the guard derived from a verified token — and
 * there is no overload that accepts one from a body. That is the invariant, and
 * it is enforced by the shape of these signatures rather than by a check inside
 * them: there is no parameter to smuggle an id through.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    /**
     * A digest of a password nobody knows, computed at boot by an async factory
     * provider. Injected rather than memoised on first use — see
     * `DUMMY_PASSWORD_HASH` for why the difference is observable.
     */
    @Inject(DUMMY_PASSWORD_HASH) private readonly dummyPasswordHash: string,
    private readonly tokens: AccessTokenService,
  ) {}

  /**
   * Creates an account and signs the new user straight in.
   *
   * The password is hashed *before* the uniqueness check, which costs an Argon2
   * hash on a duplicate registration. That is the intended trade: the
   * alternative — look up the email, then hash, then insert — is a race two
   * simultaneous registrations both win, and it also answers a duplicate in
   * microseconds while answering a fresh address in tens of milliseconds. The
   * store enforces uniqueness atomically and raises `EmailTakenError`.
   */
  async register(request: RegisterRequest): Promise<AuthSession> {
    const passwordHash = await this.hasher.hash(request.password);

    const user = await this.users.create({
      email: request.email,
      displayName: request.displayName,
      passwordHash,
    });

    return this.session(user);
  }

  /**
   * Exchanges credentials for a session.
   *
   * **This is not an enumeration oracle**, and both halves of that matter:
   *
   *  - *The body.* An unknown email and a wrong password raise the same
   *    `InvalidCredentialsError` — same code, same message, no details. Nothing
   *    in the response distinguishes them.
   *  - *The cost.* Verification runs on every path. When no account matches, it
   *    runs against `dummyPasswordHash`, so the work done is the work a real
   *    account's password check would do. Returning early on `user === null`
   *    would leave a timing difference of milliseconds against microseconds —
   *    trivially measurable over the network, and a membership test for every
   *    address an attacker cares to try.
   *
   * The result is computed and only then branched on, so the two failure paths
   * execute the same operations in the same order.
   */
  async login(request: LoginRequest): Promise<AuthSession> {
    const user = await this.users.findByEmail(request.email);
    const matches = await this.hasher.verify(
      user?.passwordHash ?? this.dummyPasswordHash,
      request.password,
    );

    if (user === null || !matches) {
      throw new InvalidCredentialsError();
    }

    return this.session(user);
  }

  /**
   * Ends every session this user has, not merely this one.
   *
   * Bumping `tokenVersion` invalidates every access token issued so far: the
   * guard compares the stored version with the token's claim on every request,
   * so the token in the caller's hand stops verifying immediately, as does the
   * one in the other browser they forgot about. A stateless JWT with no such
   * check would leave logout cosmetic — the client would forget the token while
   * the server kept honouring it until it expired.
   *
   * The account can legitimately be gone (deleted while a valid token was still
   * in circulation); that is a 401, not a 404, and certainly not a 500.
   */
  async logout(actor: RequestUser): Promise<void> {
    const version = await this.users.incrementTokenVersion(actor.id);

    if (version === null) {
      throw new UnauthenticatedError();
    }
  }

  /**
   * The caller, as they see themselves.
   *
   * No lookup: the guard already loaded the record from storage on this request
   * — it has to, to check `tokenVersion` — so re-reading it here would be a
   * second query for an answer that is already in hand and no fresher.
   */
  me(actor: RequestUser): AuthenticatedUser {
    return actor;
  }

  /** A freshly signed session for a user. The only place a token is minted. */
  private async session(user: UserRecord): Promise<AuthSession> {
    const { accessToken, expiresIn } = await this.tokens.issue(user);

    return { accessToken, expiresIn, user: toAuthenticatedUser(user) };
  }
}
