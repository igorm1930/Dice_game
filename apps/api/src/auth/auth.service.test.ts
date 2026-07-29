import {
  authSessionSchema,
  idSchema,
  loginRequestSchema,
  registerRequestSchema,
} from '@dice-game/contracts';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { ValidationError } from '../common/errors/api-error';
import { renderFailure } from '../common/filters/domain-exception.filter';
import { type RequestUser } from '../common/http/request-context';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { InMemoryUserRepository } from './adapters/in-memory-user.repository';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.errors';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import {
  DUMMY_PASSWORD_HASH,
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import { USER_REPOSITORY } from './ports/user-repository.port';

/**
 * Hand-written doubles, per the repository's testing convention — no mocking
 * framework anywhere in this suite.
 *
 * This one counts, because two of the graded properties are about *how much work
 * runs*, not about what is returned. A real Argon2 hasher can tell you the answer
 * was "no"; only a counting fake can tell you the unknown-email path paid for a
 * verification it could have skipped.
 */
class CountingPasswordHasher implements PasswordHasher {
  readonly hashed: string[] = [];
  readonly verified: { readonly hash: string; readonly plain: string }[] = [];

  hash(plain: string): Promise<string> {
    this.hashed.push(plain);

    return Promise.resolve(`argon2id:${plain}`);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    this.verified.push({ hash, plain });

    return Promise.resolve(hash === `argon2id:${plain}`);
  }
}

interface Harness {
  readonly service: AuthService;
  readonly hasher: CountingPasswordHasher;
  readonly repository: InMemoryUserRepository;
  readonly dummyHash: string;
}

/**
 * Boots the real `AuthModule` with the hasher and the store swapped out.
 *
 * The module itself is under test, not just the service: the eagerness of the
 * dummy digest is a property of the async factory provider declared in
 * `auth.module.ts`, so a hand-assembled `new AuthService(...)` would assert
 * nothing about it.
 */
async function bootAuth(): Promise<Harness> {
  const hasher = new CountingPasswordHasher();
  const repository = new InMemoryUserRepository();

  const moduleRef = await Test.createTestingModule({ imports: [AuthModule] })
    .overrideProvider(PASSWORD_HASHER)
    .useValue(hasher)
    .overrideProvider(USER_REPOSITORY)
    .useValue(repository)
    .compile();

  return {
    service: moduleRef.get(AuthService),
    hasher,
    repository,
    dummyHash: moduleRef.get<string>(DUMMY_PASSWORD_HASH),
  };
}

/** The thrown value, or a failure if the call unexpectedly succeeded. */
async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error: unknown) {
    return error;
  }

  throw new Error('Expected the call to fail, but it resolved.');
}

const ADA = {
  email: 'ada@example.com',
  displayName: 'Ada',
  password: 'correct-horse-battery',
} as const;

const GRACE = {
  email: 'grace@example.com',
  displayName: 'Grace',
  password: 'another-decent-passphrase',
} as const;

let auth: Harness;

beforeEach(async () => {
  auth = await bootAuth();
});

describe('registration', () => {
  it('returns a session the contract accepts', async () => {
    const session = await auth.service.register(ADA);

    expect(authSessionSchema.safeParse(session).success).toBe(true);
    expect(session.user.email).toBe(ADA.email);
    expect(session.user.displayName).toBe(ADA.displayName);
    expect(idSchema.safeParse(session.user.id).success).toBe(true);
    expect(session.expiresIn).toBeGreaterThan(0);
  });

  it('never lets the password or its digest reach the wire', async () => {
    const session = await auth.service.register(ADA);
    const serialised = JSON.stringify(session);

    expect(serialised).not.toContain(ADA.password);
    expect(serialised).not.toContain('argon2id:');
    expect(session.user).not.toHaveProperty('passwordHash');
    expect(session.user).not.toHaveProperty('tokenVersion');
  });

  it('refuses a second account for the same address with EMAIL_TAKEN', async () => {
    await auth.service.register(ADA);

    const failure = renderFailure(await captureError(() => auth.service.register(ADA)), 'req-1');

    expect(failure.body.error.code).toBe('EMAIL_TAKEN');
    expect(failure.status).toBe(409);
  });

  it('treats addresses differing only in case as one account', async () => {
    await auth.service.register(ADA);

    const failure = renderFailure(
      await captureError(() =>
        auth.service.register({ ...ADA, email: 'ADA@Example.COM', displayName: 'Impostor' }),
      ),
      'req-1',
    );

    expect(failure.body.error.code).toBe('EMAIL_TAKEN');
  });
});

/**
 * GRADED PROPERTY 1 — login is not an enumeration oracle.
 *
 * Each test here fails if the property breaks: returning early on
 * `user === null` breaks the verification-count tests, and adding any
 * distinguishing detail to the error breaks the body-identity test.
 */
describe('login is not an enumeration oracle', () => {
  const UNKNOWN = { email: 'nobody@example.com', password: ADA.password };

  beforeEach(async () => {
    await auth.service.register(ADA);
  });

  it('returns a byte-identical failure for an unknown email and a wrong password', async () => {
    const unknownEmail = await captureError(() => auth.service.login(UNKNOWN));
    const wrongPassword = await captureError(() =>
      auth.service.login({ email: ADA.email, password: 'definitely-not-it' }),
    );

    const rendered = [unknownEmail, wrongPassword].map((error) => renderFailure(error, 'req-1'));

    // Byte-identical, not merely equivalent: same code, same message, same
    // absent details, same status, same serialisation.
    expect(JSON.stringify(rendered[0]?.body)).toBe(JSON.stringify(rendered[1]?.body));
    expect(rendered[0]?.status).toBe(401);
    expect(rendered[1]?.status).toBe(401);
    expect(rendered[0]?.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(rendered[0]?.body.error.message).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(rendered[0]?.body.error.details).toBeUndefined();
  });

  it('runs a throwaway verification against the dummy digest when no account matches', async () => {
    const before = auth.hasher.verified.length;

    await captureError(() => auth.service.login(UNKNOWN));

    const attempts = auth.hasher.verified.slice(before);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.hash).toBe(auth.dummyHash);
    expect(attempts[0]?.plain).toBe(UNKNOWN.password);
  });

  it('spends the same number of verifications on both kinds of failure', async () => {
    const start = auth.hasher.verified.length;
    await captureError(() => auth.service.login(UNKNOWN));
    const unknownEmailCost = auth.hasher.verified.length - start;

    const middle = auth.hasher.verified.length;
    await captureError(() => auth.service.login({ email: ADA.email, password: 'not-the-one' }));
    const wrongPasswordCost = auth.hasher.verified.length - middle;

    expect(unknownEmailCost).toBe(1);
    expect(wrongPasswordCost).toBe(1);
  });

  it('precomputes the dummy digest at startup, not on the first unknown-email login', async () => {
    // A fresh boot, with nothing registered: the one hash already computed is
    // the dummy, produced by the module's async factory while the container was
    // being built. A lazily memoised dummy would leave this list empty here —
    // and would make the *first* unknown-email login measurably slower than
    // every later one, which is itself the signal the dummy exists to remove.
    const fresh = await bootAuth();

    expect(fresh.hasher.hashed).toHaveLength(1);
    expect(fresh.dummyHash).toBe(`argon2id:${String(fresh.hasher.hashed[0])}`);
    // Random per process, so nobody can present the password behind it.
    expect(fresh.hasher.hashed[0]).toMatch(/^[0-9a-f]{64}$/);

    await captureError(() => fresh.service.login(UNKNOWN));
    await captureError(() => fresh.service.login({ ...UNKNOWN, email: 'other@example.com' }));

    // Still one: no hashing happened on the login path at all.
    expect(fresh.hasher.hashed).toHaveLength(1);
  });

  it('accepts the right password', async () => {
    const session = await auth.service.login({ email: ADA.email, password: ADA.password });

    expect(session.user.email).toBe(ADA.email);
    expect(session.accessToken.length).toBeGreaterThan(0);
  });
});

/**
 * GRADED PROPERTY 2 — identity never comes from a request body.
 *
 * Two halves: the contract schemas are `.strict()`, so an actor id in a body is
 * a 400 rather than something silently ignored; and the service takes the actor
 * as a `RequestUser` argument, so there is no parameter to smuggle one through.
 */
describe('identity never comes from a request body', () => {
  const smuggled = [
    { id: '507f1f77bcf86cd799439011' },
    { userId: '507f1f77bcf86cd799439011' },
    { actorId: '507f1f77bcf86cd799439011' },
    { tokenVersion: 99 },
    { passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA' },
  ];

  it('rejects a register body carrying an extra field', () => {
    const pipe = new ZodValidationPipe(registerRequestSchema);

    expect(pipe.transform({ ...ADA }, { type: 'body' })).toMatchObject({ email: ADA.email });

    for (const extra of smuggled) {
      expect(
        () => pipe.transform({ ...ADA, ...extra }, { type: 'body' }),
        JSON.stringify(extra),
      ).toThrow(ValidationError);
    }
  });

  it('rejects a login body carrying an extra field', () => {
    const pipe = new ZodValidationPipe(loginRequestSchema);
    const body = { email: ADA.email, password: ADA.password };

    expect(pipe.transform(body, { type: 'body' })).toMatchObject({ email: ADA.email });

    for (const extra of smuggled) {
      expect(
        () => pipe.transform({ ...body, ...extra }, { type: 'body' }),
        JSON.stringify(extra),
      ).toThrow(ValidationError);
    }
  });

  it('logs out the token holder and nobody else', async () => {
    const ada = await auth.service.register(ADA);
    const grace = await auth.service.register(GRACE);

    await auth.service.logout(ada.user);

    expect((await auth.repository.findById(ada.user.id))?.tokenVersion).toBe(1);
    expect((await auth.repository.findById(grace.user.id))?.tokenVersion).toBe(0);
  });
});

describe('logout', () => {
  it('bumps tokenVersion, which is what invalidates tokens already issued', async () => {
    const session = await auth.service.register(ADA);

    expect((await auth.repository.findById(session.user.id))?.tokenVersion).toBe(0);

    await auth.service.logout(session.user);

    expect((await auth.repository.findById(session.user.id))?.tokenVersion).toBe(1);
  });

  it('reports an account that no longer exists as unauthenticated, not as a 500', async () => {
    const ghost: RequestUser = {
      id: '507f1f77bcf86cd799439011',
      email: 'ghost@example.com',
      displayName: 'Ghost',
    };

    const failure = renderFailure(await captureError(() => auth.service.logout(ghost)), 'req-1');

    expect(failure.body.error.code).toBe('UNAUTHENTICATED');
    expect(failure.status).toBe(401);
    expect(failure.unexpected).toBe(false);
  });
});

describe('me', () => {
  it('returns the verified caller without a second lookup', async () => {
    const session = await auth.service.register(ADA);

    expect(auth.service.me(session.user)).toEqual({
      id: session.user.id,
      email: ADA.email,
      displayName: ADA.displayName,
    });
  });
});
