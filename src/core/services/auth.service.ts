import {
  InvalidCredentialsError,
  UnauthenticatedError,
  UserNotFoundError,
  toPlayerIdentity,
  usernameKeyOf,
  type PlayerIdentity,
  type User,
} from '../domain/user';
import type { AuthTokenService } from '../ports/auth-token.port';
import type { Clock } from '../ports/clock.port';
import type { IdGenerator } from '../ports/id-generator.port';
import type { PasswordHasher } from '../ports/password-hasher.port';
import type { UserRepository } from '../ports/user-repository.port';

/**
 * Constant fed to the hasher when a login names an unknown player, so the
 * endpoint costs the same whether or not the username exists. Without it, a
 * missing user returns in microseconds and a real one in ~100 ms, which is a
 * perfectly usable account-enumeration oracle regardless of the shared message.
 */
const TIMING_EQUALISATION_SECRET = 'not-a-password-only-here-to-burn-the-same-cpu';

export interface AuthenticatedSession {
  readonly player: PlayerIdentity;
  readonly token: string;
}

export interface AuthServiceDependencies {
  readonly users: UserRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: AuthTokenService;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * Registration, login, and credential resolution.
 *
 * Holds no HTTP concepts: it takes a username and a password and returns a
 * token, and the delivery layer decides that the token travels in an
 * `Authorization` header and that a failure is a 401.
 */
export class AuthService {
  private readonly users: UserRepository;
  private readonly hasher: PasswordHasher;
  private readonly tokens: AuthTokenService;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;

  /** Computed at most once, then reused for every unknown-user login. */
  private equalisationHash: Promise<string> | null = null;

  constructor(dependencies: AuthServiceDependencies) {
    this.users = dependencies.users;
    this.hasher = dependencies.hasher;
    this.tokens = dependencies.tokens;
    this.idGenerator = dependencies.idGenerator;
    this.clock = dependencies.clock;
  }

  /**
   * Registers a player and logs them straight in.
   *
   * @throws {UsernameTakenError} raised by the repository's unique index.
   */
  async register(username: string, password: string): Promise<AuthenticatedSession> {
    const trimmed = username.trim();

    const created = await this.users.create({
      id: this.idGenerator.generate(),
      username: trimmed,
      usernameKey: usernameKeyOf(trimmed),
      passwordHash: await this.hasher.hash(password),
      wins: 0,
      createdAt: this.clock.now().toISOString(),
    });

    return this.startSession(created);
  }

  /**
   * @throws {InvalidCredentialsError} for a wrong password *and* an unknown
   *   user — the caller must not be able to tell the two apart.
   */
  async login(username: string, password: string): Promise<AuthenticatedSession> {
    const user = await this.users.findByUsername(username);

    if (!user) {
      await this.hasher.verify(password, await this.equalisation());
      throw new InvalidCredentialsError();
    }

    if (!(await this.hasher.verify(password, user.passwordHash))) {
      throw new InvalidCredentialsError();
    }

    return this.startSession(user);
  }

  async logout(token: string): Promise<void> {
    await this.tokens.revoke(token);
  }

  /**
   * Resolves a bearer credential to the player behind it.
   *
   * @throws {UnauthenticatedError} if the token is unknown, expired, or names a
   *   player who no longer exists.
   */
  async authenticate(token: string): Promise<User> {
    const userId = await this.tokens.resolve(token);
    if (userId === null) {
      throw new UnauthenticatedError('the credential is invalid or has expired');
    }

    const user = await this.users.findById(userId);
    if (!user) {
      // The session outlived its player — treat the credential as dead rather
      // than letting a ghost identity act.
      await this.tokens.revoke(token);
      throw new UnauthenticatedError('the credential is invalid or has expired');
    }

    return user;
  }

  /**
   * @throws {UserNotFoundError} when naming an opponent who has not registered.
   */
  async requireByUsername(username: string): Promise<User> {
    const user = await this.users.findByUsername(username);
    if (!user) {
      throw new UserNotFoundError(username.trim());
    }
    return user;
  }

  private async startSession(user: User): Promise<AuthenticatedSession> {
    return { player: toPlayerIdentity(user), token: await this.tokens.issue(user.id) };
  }

  private equalisation(): Promise<string> {
    this.equalisationHash ??= this.hasher.hash(TIMING_EQUALISATION_SECRET);
    return this.equalisationHash;
  }
}
