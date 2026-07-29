import { ERROR_STATUS } from '@dice-game/contracts';
import { type ArgumentsHost, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { beforeAll, describe, expect, it } from 'vitest';

import { GameOverError, NotAParticipantError, UnsupportedRulesetError } from '../../domain/errors';
import { ApiError, UnauthenticatedError, ValidationError } from '../errors/api-error';
import { type AppRequest, setRequestId } from '../http/request-context';
import {
  DomainExceptionFilter,
  OPAQUE_ERROR_MESSAGE,
  renderFailure,
} from './domain-exception.filter';

/**
 * Hand-written doubles, per the repository's testing convention. A recorder is
 * enough here: the filter's whole job is "given a thrown thing, write this
 * status and this body".
 */
interface RecordedResponse {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, unknown>;
  headersSent: boolean;
}

function fakeHost(): { host: ArgumentsHost; response: RecordedResponse; request: AppRequest } {
  const response: RecordedResponse = {
    statusCode: null,
    body: undefined,
    headers: {},
    headersSent: false,
  };

  const responseApi = {
    get headersSent(): boolean {
      return response.headersSent;
    },
    setHeader(name: string, value: unknown): void {
      response.headers[name] = value;
    },
    status(code: number) {
      response.statusCode = code;

      return this;
    },
    json(body: unknown): void {
      response.body = body;
    },
  };

  const request = { headers: {} } as unknown as AppRequest;
  setRequestId(request, 'req-fixed-1');

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => responseApi,
    }),
  } as unknown as ArgumentsHost;

  return { host, response, request };
}

const REQUEST_ID = 'req-fixed-1';

beforeAll(() => {
  // The filter logs every 5xx with a stack. Useful in production, noise here.
  Logger.overrideLogger(false);
});

describe('domain errors', () => {
  it('takes the status from the contract table, keyed by the code', () => {
    const rendered = renderFailure(new GameOverError('roll', 0), REQUEST_ID);

    expect(rendered.body.error.code).toBe('GAME_OVER');
    expect(rendered.status).toBe(ERROR_STATUS.GAME_OVER);
    expect(rendered.status).toBe(409);
  });

  it('maps every domain error this delivery layer can meet', () => {
    const cases = [
      [new NotAParticipantError('u1'), 'NOT_A_PARTICIPANT', 403],
      [new UnsupportedRulesetError({ id: 'standard', version: 9 }), 'UNSUPPORTED_RULESET', 422],
    ] as const;

    for (const [error, code, status] of cases) {
      const rendered = renderFailure(error, REQUEST_ID);

      expect(rendered.body.error.code).toBe(code);
      expect(rendered.status).toBe(status);
      expect(rendered.unexpected).toBe(false);
    }
  });

  it('passes the domain details through for the client to act on', () => {
    const rendered = renderFailure(new NotAParticipantError('user-carol'), REQUEST_ID);

    expect(rendered.body.error.details).toEqual({ userId: 'user-carol' });
  });

  it('never lets the domain dictate a status directly', () => {
    // The invariant `rules-contract-agreement.test.ts` asserts from the other
    // side: a DomainError has no status property for the filter to read.
    const error = new GameOverError('hold', 1);

    expect(error).not.toHaveProperty('status');
    expect(error).not.toHaveProperty('statusCode');
  });
});

describe('delivery-layer errors', () => {
  it('renders an ApiError against the same table', () => {
    const rendered = renderFailure(new UnauthenticatedError(), REQUEST_ID);

    expect(rendered.status).toBe(401);
    expect(rendered.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('carries validation detail without echoing the rejected value', () => {
    const rendered = renderFailure(
      new ValidationError({ target: 'body', issues: [{ path: 'password', message: 'too short' }] }),
      REQUEST_ID,
    );

    expect(rendered.status).toBe(400);
    expect(rendered.body.error.code).toBe('VALIDATION_ERROR');
    expect(rendered.body.error.details).toBeDefined();
  });

  it('renders every contract code at the status the contract names', () => {
    for (const [code, status] of Object.entries(ERROR_STATUS)) {
      const rendered = renderFailure(new ApiError(code as never, 'message under test'), REQUEST_ID);

      expect(rendered.status, code).toBe(status);
      expect(rendered.body.error.code, code).toBe(code);
    }
  });
});

describe('framework exceptions', () => {
  it('maps a 404 to ROUTE_NOT_FOUND without echoing the requested path', () => {
    const rendered = renderFailure(new NotFoundException('Cannot GET /<script>'), REQUEST_ID);

    expect(rendered.status).toBe(404);
    expect(rendered.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(rendered.body.error.message).not.toContain('script');
  });

  it('maps the throttler to RATE_LIMIT_EXCEEDED', () => {
    const rendered = renderFailure(new ThrottlerException(), REQUEST_ID);

    expect(rendered.status).toBe(429);
    expect(rendered.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('refuses to invent a code for a status the contract does not cover', () => {
    // A bare ForbiddenException means a guard returned `false` instead of
    // throwing an explicit error. That is a delivery-layer bug, and reporting it
    // as an opaque 500 keeps it visible rather than dressing it as a 403.
    const rendered = renderFailure(new ForbiddenException(), REQUEST_ID);

    expect(rendered.status).toBe(500);
    expect(rendered.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    expect(rendered.unexpected).toBe(true);
  });

  it('maps a body-parser refusal by its type, not by its status', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), {
      type: 'entity.too.large',
      status: 413,
    });

    expect(renderFailure(tooLarge, REQUEST_ID).body.error.code).toBe('PAYLOAD_TOO_LARGE');

    const unparseable = Object.assign(new Error('Unexpected token }'), {
      type: 'entity.parse.failed',
      status: 400,
    });

    expect(renderFailure(unparseable, REQUEST_ID).body.error.code).toBe('MALFORMED_REQUEST_BODY');
  });
});

describe('resistance to downgrading a 500', () => {
  it('ignores a status property on an arbitrary object', () => {
    for (const thrown of [
      { status: 400, message: 'looks like a client error' },
      { statusCode: 404 },
      { status: 204 },
      Object.assign(new Error('boom'), { status: 401 }),
      Object.assign(new Error('boom'), { statusCode: 403 }),
    ]) {
      const rendered = renderFailure(thrown, REQUEST_ID);

      expect(rendered.status, JSON.stringify(thrown)).toBe(500);
      expect(rendered.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    }
  });

  it('ignores a code property on something that is not a recognised error', () => {
    const impostor = Object.assign(new Error('nope'), { code: 'GAME_NOT_FOUND' });

    expect(renderFailure(impostor, REQUEST_ID).status).toBe(500);
  });

  it('does not resolve a code through Object.prototype', () => {
    class Rogue extends Error {
      readonly code = 'toString';
    }

    expect(renderFailure(new Rogue('x'), REQUEST_ID).status).toBe(500);
  });

  it('treats a thrown primitive as a 500', () => {
    for (const thrown of ['a string', 42, null, undefined, Symbol('s')]) {
      expect(renderFailure(thrown, REQUEST_ID).status).toBe(500);
    }
  });
});

describe('what an unexpected failure is allowed to say', () => {
  const secrets = [
    'mongodb://admin:hunter2@cluster0.example/dice',
    '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$hash',
    'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
  ];

  it('says nothing but a fixed message', () => {
    for (const secret of secrets) {
      const rendered = renderFailure(new Error(`connect failed: ${secret}`), REQUEST_ID);
      const serialised = JSON.stringify(rendered.body);

      expect(rendered.body.error.message).toBe(OPAQUE_ERROR_MESSAGE);
      expect(serialised).not.toContain(secret);
      expect(rendered.body.error.details).toBeUndefined();
    }
  });

  it('never serialises a stack trace', () => {
    const error = new Error('inner failure');
    const rendered = renderFailure(error, REQUEST_ID);

    expect(JSON.stringify(rendered.body)).not.toContain('domain-exception.filter');
    expect(JSON.stringify(rendered.body)).not.toContain('at ');
  });
});

describe('the envelope', () => {
  it('always carries the request id', () => {
    expect(renderFailure(new Error('x'), 'req-42').body.meta).toEqual({ requestId: 'req-42' });
    expect(renderFailure(new GameOverError('roll', 0), 'req-42').body.meta.requestId).toBe(
      'req-42',
    );
  });

  it('omits details rather than sending an empty object', () => {
    expect(
      renderFailure(new UnauthenticatedError(), REQUEST_ID).body.error.details,
    ).toBeUndefined();
  });
});

describe('writing the response', () => {
  it('sets the status, the body and the correlation header', () => {
    const { host, response } = fakeHost();

    new DomainExceptionFilter().catch(new GameOverError('roll', 0), host);

    expect(response.statusCode).toBe(409);
    expect(response.headers['x-request-id']).toBe(REQUEST_ID);
    expect(response.body).toEqual({
      error: {
        code: 'GAME_OVER',
        message: expect.stringContaining('already been won') as string,
        details: { action: 'roll', winner: 0 },
      },
      meta: { requestId: REQUEST_ID },
    });
  });

  it('writes nothing once the response has begun', () => {
    const { host, response } = fakeHost();
    response.headersSent = true;

    new DomainExceptionFilter().catch(new Error('late'), host);

    expect(response.statusCode).toBeNull();
    expect(response.body).toBeUndefined();
  });

  it('rethrows for a non-HTTP context rather than guessing', () => {
    const host = { getType: () => 'rpc' } as unknown as ArgumentsHost;
    const thrown = new Error('from a queue consumer');

    expect(() => {
      new DomainExceptionFilter().catch(thrown, host);
    }).toThrow(thrown);
  });
});
