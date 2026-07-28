import { type ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { Public } from '../../common/decorators/public.decorator';
import { UnauthenticatedError } from '../../common/errors/api-error';
import { renderFailure } from '../../common/filters/domain-exception.filter';
import { type AppRequest, getRequestUser } from '../../common/http/request-context';
import { AccessTokenService, type AccessTokenClaims } from '../access-token.service';
import { InMemoryUserRepository } from '../adapters/in-memory-user.repository';
import { AuthModule } from '../auth.module';
import { AuthService } from '../auth.service';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.port';
import {
  type ListUsersOptions,
  type NewUser,
  USER_REPOSITORY,
  type UserPage,
  type UserRepository,
} from '../ports/user-repository.port';
import { type UserRecord } from '../user.entity';
import { bearerTokenFrom, JwtAuthGuard } from './jwt-auth.guard';

/** A fast stand-in for Argon2; the guard never hashes, but registration does. */
class FakePasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return Promise.resolve(`argon2id:${plain}`);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return Promise.resolve(hash === `argon2id:${plain}`);
  }
}

/**
 * The real in-memory store, wrapped so lookups can be counted.
 *
 * Counting `findById` is how "a malformed header costs no I/O" becomes an
 * assertion rather than a claim about the order of statements.
 */
class CountingUserRepository implements UserRepository {
  readonly inner = new InMemoryUserRepository();
  findByIdCalls = 0;

  findById(id: string): Promise<UserRecord | null> {
    this.findByIdCalls += 1;

    return this.inner.findById(id);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.inner.findByEmail(email);
  }

  create(user: NewUser): Promise<UserRecord> {
    return this.inner.create(user);
  }

  incrementTokenVersion(id: string): Promise<number | null> {
    return this.inner.incrementTokenVersion(id);
  }

  list(options: ListUsersOptions): Promise<UserPage> {
    return this.inner.list(options);
  }
}

/** The real token service, wrapped so signature checks can be counted. */
@Injectable()
class CountingAccessTokenService extends AccessTokenService {
  verifyCalls = 0;

  override verify(token: string): Promise<AccessTokenClaims> {
    this.verifyCalls += 1;

    return super.verify(token);
  }
}

/**
 * Stand-in routes carrying the real `@Public()` decorator, so the guard is
 * tested against the decorator the application actually uses rather than
 * against a hand-set metadata key that could drift from it.
 */
class DecoratedRoutes {
  @Public()
  open(): string {
    return 'public';
  }

  guarded(): string {
    return 'guarded';
  }
}

/**
 * The handler object Nest would hand the guard.
 *
 * Read through a property descriptor rather than as `DecoratedRoutes.prototype.open`,
 * which would be an unbound method reference — correct here, but noisy.
 */
function handlerOf(name: 'open' | 'guarded'): () => string {
  return Object.getOwnPropertyDescriptor(DecoratedRoutes.prototype, name)?.value as () => string;
}

const PUBLIC_HANDLER = handlerOf('open');
const GUARDED_HANDLER = handlerOf('guarded');

function requestWith(authorization?: string): AppRequest {
  const headers: Record<string, string> = {};

  if (authorization !== undefined) {
    headers.authorization = authorization;
  }

  return { headers } as unknown as AppRequest;
}

function contextFor(request: AppRequest, handler: () => string): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => DecoratedRoutes,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

interface Harness {
  readonly guard: JwtAuthGuard;
  readonly auth: AuthService;
  readonly repository: CountingUserRepository;
  readonly tokens: CountingAccessTokenService;
  readonly jwt: JwtService;
}

async function bootGuard(): Promise<Harness> {
  const repository = new CountingUserRepository();

  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
    .overrideProvider(PASSWORD_HASHER)
    .useValue(new FakePasswordHasher())
    .overrideProvider(USER_REPOSITORY)
    .useValue(repository)
    .overrideProvider(AccessTokenService)
    .useClass(CountingAccessTokenService)
    .compile();

  return {
    guard: moduleRef.get(JwtAuthGuard),
    auth: moduleRef.get(AuthService),
    repository,
    tokens: moduleRef.get<CountingAccessTokenService>(AccessTokenService),
    jwt: moduleRef.get(JwtService),
  };
}

/** The rejection, or a failure if the guard let the request through. */
async function rejectionFrom(harness: Harness, request: AppRequest): Promise<unknown> {
  const outcome = await harness.guard.canActivate(contextFor(request, GUARDED_HANDLER)).then(
    (allowed) => ({ allowed }),
    (error: unknown) => ({ error }),
  );

  if ('allowed' in outcome) {
    throw new Error(
      `Expected the guard to throw, but it resolved with ${String(outcome.allowed)}.`,
    );
  }

  return outcome.error;
}

const ADA = {
  email: 'ada@example.com',
  displayName: 'Ada',
  password: 'correct-horse-battery',
} as const;

let harness: Harness;

beforeEach(async () => {
  harness = await bootGuard();
});

describe('the Authorization header', () => {
  it('accepts a bearer token and nothing else', () => {
    expect(bearerTokenFrom('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    // One or more spaces; RFC 7230 allows the run, so parsing must too.
    expect(bearerTokenFrom('Bearer   abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('matches the scheme case-insensitively, as RFC 7235 requires', () => {
    // The scheme name is case-insensitive. Refusing these would 401 a
    // conforming client, which is an interoperability bug rather than a
    // defence — the strictness that matters is in the header's shape.
    expect(bearerTokenFrom('bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerTokenFrom('BEARER abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerTokenFrom('BeArEr abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('reads no token out of a header that is not exactly a bearer credential', () => {
    const malformed = [
      undefined,
      '',
      'abc.def.ghi', // a bare token with no scheme
      'Basic dXNlcjpwYXNzd29yZA==', // a different scheme
      'Bearer', // a scheme with no token
      'Bearer ', // a scheme with an empty token
      'Bearer a b', // two tokens, or whitespace inside one
      'Bearer\tabc.def.ghi', // tab, not space
      ' Bearer abc.def.ghi', // leading whitespace
      'Bearer abc.def.ghi extra',
    ];

    for (const header of malformed) {
      expect(bearerTokenFrom(header), JSON.stringify(header)).toBeNull();
    }
  });

  it('answers 401 for every one of them, through the contract error code', async () => {
    const malformed = [
      undefined,
      '',
      'abc.def.ghi',
      'Basic dXNlcjpwYXNzd29yZA==',
      'Bearer',
      'Bearer ',
      'Bearer a b',
      'Bearer\tabc.def.ghi',
    ];

    for (const header of malformed) {
      const error = await rejectionFrom(harness, requestWith(header));
      const rendered = renderFailure(error, 'req-1');

      expect(error, JSON.stringify(header)).toBeInstanceOf(UnauthenticatedError);
      expect(rendered.status, JSON.stringify(header)).toBe(401);
      expect(rendered.body.error.code).toBe('UNAUTHENTICATED');
      // Not a 500: a guard that returned `false` would produce a bare
      // ForbiddenException, which the filter deliberately renders opaquely.
      expect(rendered.unexpected).toBe(false);
    }
  });

  it('rejects a malformed header before verifying a signature or reading the store', async () => {
    await rejectionFrom(harness, requestWith('Bearer a b'));
    await rejectionFrom(harness, requestWith(undefined));
    await rejectionFrom(harness, requestWith('Basic dXNlcjpwYXNz'));

    expect(harness.tokens.verifyCalls).toBe(0);
    expect(harness.repository.findByIdCalls).toBe(0);
  });
});

describe('public routes', () => {
  it('lets a @Public() route through with no credential at all', async () => {
    const request = requestWith(undefined);

    await expect(harness.guard.canActivate(contextFor(request, PUBLIC_HANDLER))).resolves.toBe(
      true,
    );
    expect(getRequestUser(request)).toBeNull();
    expect(harness.repository.findByIdCalls).toBe(0);
  });

  it('attaches no identity to a public route even when a valid token is present', async () => {
    const session = await harness.auth.register(ADA);
    const request = requestWith(`Bearer ${session.accessToken}`);

    await expect(harness.guard.canActivate(contextFor(request, PUBLIC_HANDLER))).resolves.toBe(
      true,
    );
    // Register and login must not act on behalf of whoever is already signed in.
    expect(getRequestUser(request)).toBeNull();
  });
});

describe('a verified token', () => {
  it('attaches the caller through setRequestUser, which is what CurrentUser reads', async () => {
    const session = await harness.auth.register(ADA);
    const request = requestWith(`Bearer ${session.accessToken}`);

    await expect(harness.guard.canActivate(contextFor(request, GUARDED_HANDLER))).resolves.toBe(
      true,
    );

    expect(getRequestUser(request)).toEqual({
      id: session.user.id,
      email: ADA.email,
      displayName: ADA.displayName,
    });
  });

  it('never attaches a password digest or a token version', async () => {
    const session = await harness.auth.register(ADA);
    const request = requestWith(`Bearer ${session.accessToken}`);

    await harness.guard.canActivate(contextFor(request, GUARDED_HANDLER));

    expect(getRequestUser(request)).not.toHaveProperty('passwordHash');
    expect(getRequestUser(request)).not.toHaveProperty('tokenVersion');
  });

  it('rejects a token naming a user who does not exist', async () => {
    const ghost: UserRecord = {
      id: '507f1f77bcf86cd799439011',
      email: 'ghost@example.com',
      displayName: 'Ghost',
      passwordHash: 'argon2id:irrelevant',
      tokenVersion: 0,
      createdAt: new Date(),
    };
    const { accessToken } = await harness.tokens.issue(ghost);

    expect(await rejectionFrom(harness, requestWith(`Bearer ${accessToken}`))).toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const session = await harness.auth.register(ADA);
    const forger = new JwtService({
      secret: 'a-completely-different-signing-secret',
      signOptions: { expiresIn: '15m' },
    });
    const forged = await forger.signAsync({ sub: session.user.id, tokenVersion: 0 });

    expect(await rejectionFrom(harness, requestWith(`Bearer ${forged}`))).toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects an expired token', async () => {
    const session = await harness.auth.register(ADA);
    const expired = await harness.jwt.signAsync(
      { sub: session.user.id, tokenVersion: 0 },
      { expiresIn: '-1s' },
    );

    expect(await rejectionFrom(harness, requestWith(`Bearer ${expired}`))).toBeInstanceOf(
      UnauthenticatedError,
    );
  });

  it('rejects a correctly signed token whose claims do not match the schema', async () => {
    // Correct secret, wrong subject: `sub` is validated against the contract's
    // idSchema, so an arbitrary string cannot reach the store as a lookup key.
    const bogus = await harness.jwt.signAsync({ sub: '../../etc/passwd', tokenVersion: 0 });

    expect(await rejectionFrom(harness, requestWith(`Bearer ${bogus}`))).toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(harness.repository.findByIdCalls).toBe(0);
  });

  it('rejects a token whose tokenVersion no longer matches the stored one', async () => {
    const session = await harness.auth.register(ADA);

    await harness.repository.incrementTokenVersion(session.user.id);

    expect(
      await rejectionFrom(harness, requestWith(`Bearer ${session.accessToken}`)),
    ).toBeInstanceOf(UnauthenticatedError);
  });
});

/**
 * GRADED PROPERTY 3 — revocation is real.
 *
 * This test fails if the guard stops comparing `tokenVersion` against stored
 * state, which is precisely the shortcut that makes logout cosmetic: the token
 * would keep verifying on its signature alone until it expired.
 */
describe('revocation is real', () => {
  it('stops honouring a token the moment its user logs out', async () => {
    const session = await harness.auth.register(ADA);

    // 1. The token works.
    const before = requestWith(`Bearer ${session.accessToken}`);
    await expect(harness.guard.canActivate(contextFor(before, GUARDED_HANDLER))).resolves.toBe(
      true,
    );
    expect(getRequestUser(before)).toEqual(session.user);

    // 2. Log out.
    await harness.auth.logout(session.user);

    // 3. The same token — byte for byte — is now a 401.
    const after = requestWith(`Bearer ${session.accessToken}`);
    const error = await rejectionFrom(harness, after);
    const rendered = renderFailure(error, 'req-1');

    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect(rendered.status).toBe(401);
    expect(rendered.body.error.code).toBe('UNAUTHENTICATED');
    expect(getRequestUser(after)).toBeNull();
  });

  it('revokes every token issued before the logout, not only the one presented', async () => {
    const first = await harness.auth.register(ADA);
    const second = await harness.auth.login({ email: ADA.email, password: ADA.password });

    expect(second.accessToken).not.toBe('');

    await harness.auth.logout(first.user);

    for (const token of [first.accessToken, second.accessToken]) {
      expect(await rejectionFrom(harness, requestWith(`Bearer ${token}`))).toBeInstanceOf(
        UnauthenticatedError,
      );
    }
  });

  it('lets the same user sign in again afterwards', async () => {
    const session = await harness.auth.register(ADA);
    await harness.auth.logout(session.user);

    const renewed = await harness.auth.login({ email: ADA.email, password: ADA.password });
    const request = requestWith(`Bearer ${renewed.accessToken}`);

    await expect(harness.guard.canActivate(contextFor(request, GUARDED_HANDLER))).resolves.toBe(
      true,
    );
  });
});

describe('failing closed', () => {
  it('throws rather than resolving false, so the filter renders 401 and not 500', async () => {
    const requests = [
      requestWith(undefined),
      requestWith('Bearer not-a-real-token'),
      requestWith('nonsense'),
    ];

    for (const request of requests) {
      // `rejectionFrom` itself fails the test if the guard resolves at all —
      // returning `false` would be caught here, not silently tolerated.
      const error = await rejectionFrom(harness, request);

      expect(error).not.toBe(false);
      expect(renderFailure(error, 'req-1').status).toBe(401);
    }
  });
});
